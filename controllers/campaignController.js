const Campaign = require("../models/Campaign");
const User = require("../models/User");
 
exports.createCampaign = async (req, res) => {
  try {
    const { campaignName, message, phoneNumbers } = req.body;

    // 1. GET USER FROM DB
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 2. PROCESS PHONE NUMBERS
    const numbersArray = Array.isArray(phoneNumbers)
      ? phoneNumbers
      : [phoneNumbers];

    // 3. CHECK CREDITS
    if (user.credits < numbersArray.length) {
      return res.status(400).json({ message: "Not enough credits" });
    }

    // 4. DEDUCT CREDITS
    user.credits -= numbersArray.length;
    await user.save();

    // 5. PROCESS FILES 
    const imageFiles = Array.isArray(req.files?.images) 
      ? req.files.images 
      : req.files?.images ? [req.files.images] : [];
    
    const docFiles = Array.isArray(req.files?.pdfVideo) 
      ? req.files.pdfVideo 
      : req.files?.pdfVideo ? [req.files.pdfVideo] : [];

    const media = [
  ...imageFiles.map(file => ({
    url: file.path,
    publicId: file.filename,
    type: "image"
  })),

  ...docFiles.map(file => {
    let type = "file";

    // detect video
    if (file.mimetype && file.mimetype.startsWith("video")) {
      type = "video";
    }

    // detect pdf
    if (file.mimetype === "application/pdf") {
      type = "file";
    }

    return {
      url: file.path,
      publicId: file.filename,
      type
    };
  })
];


    // 6. CREATE CAMPAIGN (NOW user is defined!)
    const campaign = await Campaign.create({
      userId: user._id,
      title: campaignName,
      message,
      phoneNumbers: numbersArray,
      media
    });
    const userDoc = await User.findById(user._id)

    res.status(201).json({
      message: "Campaign created successfully",
      campaign, userDoc
    });

  } catch (err) {
    console.error('Campaign error:', err.message);
    res.status(500).json({
      message: "Campaign creation failed",
      error: err.message
    });
  }
};
