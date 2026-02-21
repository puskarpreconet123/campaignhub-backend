const Campaign = require("../models/Campaign");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const s3 = require("../config/wasabi"); // your existing S3 client

exports.createCampaign = async (req, res) => {
  // Start transaction session
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { campaignName, message, phoneNumbers } = req.body;
    const userId = req.user.id;

    // 1️⃣ Fetch user
    const user = await User.findById(userId).session(session);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 2️⃣ Normalize phone numbers
    const numbersArray = Array.isArray(phoneNumbers)
      ? phoneNumbers
      : [phoneNumbers];

    const totalRecipients = numbersArray.length;

    // 3️⃣ Check user credits
    if (user.credits < totalRecipients) {
      return res.status(400).json({ message: "Not enough credits" });
    }

    // 4️⃣ Deduct credits
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { credits: -totalRecipients } },
      { session, new: true }
    );

    // 5️⃣ Create transaction log
    await Transaction.create(
      [
        {
          userId,
          targetUserId: userId,
          type: "debit",
          amount: totalRecipients,
          description: `Campaign: ${campaignName}`,
        },
      ],
      { session }
    );

    // 6️⃣ Helper functions for dynamic provider
    const getFileUrl = (file) => file.location || file.path;
    const getFileId = (file) => file.key || file.filename;
    const provider = req.storageProvider; // from dynamicUpload middleware

    // 7️⃣ Process uploaded files
    const imageFiles = Array.isArray(req.files?.images)
      ? req.files.images
      : req.files?.images
      ? [req.files.images]
      : [];

    const docFiles = Array.isArray(req.files?.pdfVideo)
      ? req.files.pdfVideo
      : req.files?.pdfVideo
      ? [req.files.pdfVideo]
      : [];

    const media = [
      // Images
      ...imageFiles.map((file) => ({
        url: getFileUrl(file),
        publicId: getFileId(file),
        type: "image",
        provider,
      })),

      // Videos & PDFs
      ...docFiles.map((file) => {
        let type = "file";
        if (file.mimetype && file.mimetype.startsWith("video")) type = "video";
        if (file.mimetype === "application/pdf") type = "file";

        return {
          url: getFileUrl(file),
          publicId: getFileId(file),
          type,
          provider,
        };
      }),
    ];

    // 8️⃣ Create Campaign
    const [campaign] = await Campaign.create(
      [
        {
          userId: user._id,
          title: campaignName,
          message,
          phoneNumbers: numbersArray,
          media,
        },
      ],
      { session }
    );

    // 9️⃣ Commit transaction
    await session.commitTransaction();

    res.status(201).json({
      message: "Campaign created successfully",
      campaign,
      userDoc: updatedUser,
    });
  } catch (err) {
    // Abort transaction on error
    await session.abortTransaction();
    console.error("Campaign error:", err.message);
    res.status(500).json({
      message: "Campaign creation failed",
      error: err.message,
    });
  } finally {
    session.endSession();
  }
};

exports.getCampaignMedia = async (req, res) => {
  try {
    const { campaignId, mediaId } = req.params;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    const media = campaign.media.id(mediaId);
    if (!media) return res.status(404).json({ message: "Media not found" });

    if (media.provider === "wasabi") {
      const command = new GetObjectCommand({
        Bucket: process.env.WASABI_BUCKET,
        Key: media.publicId,
      });

      // expires in 5 minutes
      const url = await getSignedUrl(s3, command, { expiresIn: 300 });
      return res.json({ url });
    }

    if (media.provider === "cloudinary") {
      return res.json({ url: media.url });
    }

    res.status(400).json({ message: "Unknown provider" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch media" });
  }
};
