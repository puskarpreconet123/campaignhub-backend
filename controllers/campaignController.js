const Campaign = require("../models/Campaign");
const User = require("../models/User");
const Transaction = require("../models/Transaction")
const mongoose = require("mongoose");
 
exports.createCampaign = async (req, res) => {
  // start session inside the function
  const session = await mongoose.startSession();
  session.startTransaction()
  try {
    const { campaignName, message, phoneNumbers } = req.body;
    const userId = req.user.id
    // 1. GET USER FROM DB
    const user = await User.findById(userId).session(session);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 2. PROCESS PHONE NUMBERS
    const numbersArray = Array.isArray(phoneNumbers)
      ? phoneNumbers
      : [phoneNumbers];

    // 3. CHECK CREDITS
    const count = numbersArray.length
    if (user.credits < count) {
      return res.status(400).json({ message: "Not enough credits" });
    }

   // 1. Update User Credits
  const updatedUser = await User.findByIdAndUpdate(userId, 
    { $inc: { credits: -count } }, 
    { session, new: true }
  );

  // 2. Create History Log
  await Transaction.create([{
    userId,
    targetUserId: userId,
    type: 'debit',
    amount: count,
    description: `Campaign: ${campaignName}`
  }], { session });

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
    const [campaign] = await Campaign.create(
      [{
        userId: user._id,
        title: campaignName,
        message,
        phoneNumbers: numbersArray,
        media
      }],
      { session }
    );
    await session.commitTransaction();

    res.status(201).json({
      message: "Campaign created successfully",
      campaign,
      userDoc:updatedUser
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('Campaign error:', err.message);
    res.status(500).json({
      message: "Campaign creation failed",
      error: err.message
    });
  }finally {
  session.endSession();
}
};
