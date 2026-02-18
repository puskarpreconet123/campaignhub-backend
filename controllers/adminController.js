const { json } = require("express");
const User = require("../models/User");
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction")
const mongoose = require("mongoose")
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("../config/wasabi");
const { v4: uuidv4 } = require("uuid");
const _ = require('lodash');

exports.createUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 1️⃣ Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 5) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // 2️⃣ Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // 3️⃣ Hash password
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Create user
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: "user",
    });

    // 5️⃣ Return safe response (never send password)
    res.status(201).json({
      message: "User created successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

  } catch (error) {
    console.error("Create User Error:", error);
    res.status(500).json({ message: "Server error while creating user" });
  }
};

exports.addCredits = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1️⃣ Auth safety (extra layer)
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin only action" });
    }
    const userEmail = req.body.userId
    const { credits } = req.body; // renamed for clarity
    const adminId = req.user.id;
    console.log(req.body)
    // 2️⃣ Input validation
    if (!userEmail || typeof credits !== "number") {
      throw new Error("INVALID_INPUT: Valid email and credit amount required");
    }

    if (credits === 0) {
      throw new Error("INVALID_INPUT: Credit amount cannot be zero");
    }

    const amount = Math.abs(credits);
    const isReduction = credits < 0;

    // Prevent admin transferring to themselves
    const admin = await User.findById(adminId).session(session);
    if (!admin) throw new Error("AUTH_ERROR: Admin not found");

    if (admin.email === userEmail) {
      throw new Error("INVALID_ACTION: Cannot transfer credits to yourself");
    }

    if (isReduction) {
      /**
       * CASE 1: REMOVE credits from user → Admin gets them
       */

      const updatedUser = await User.findOneAndUpdate(
        { email: userEmail, credits: { $gte: amount } },
        { $inc: { credits: -amount } },
        { session, new: true }
      ).select("-password");

      if (!updatedUser) {
        throw new Error("USER_ERROR: User not found or insufficient credits");
      }

      const updatedAdmin = await User.findByIdAndUpdate(
        adminId,
        { $inc: { credits: amount } },
        { session, new: true }
      );

      await Transaction.create([
        {
          userId: adminId,
          targetUserId: updatedUser._id,
          type: "credit",
          amount,
          description: "Credits recovered from user"
        },
        {
          userId: updatedUser._id,
          targetUserId: adminId,
          type: "debit",
          amount,
          description: "Credits deducted by admin"
        }
      ], { session, ordered: true });

      await session.commitTransaction();

      return res.json({
        message: "Credits reduced successfully",
        newAdminBalance: updatedAdmin.credits,
        targetUser: updatedUser
      });

    } else {
      /**
       * CASE 2: ADD credits to user → Admin loses them
       */

      const updatedAdmin = await User.findOneAndUpdate(
        { _id: adminId, credits: { $gte: amount } },
        { $inc: { credits: -amount } },
        { session, new: true }
      );

      if (!updatedAdmin) {
        throw new Error("CREDIT_ERROR: Admin has insufficient credits");
      }

      const targetUser = await User.findOneAndUpdate(
        { email: userEmail },
        { $inc: { credits: amount } },
        { session, new: true }
      ).select("-password");

      if (!targetUser) {
        throw new Error("USER_ERROR: Target user not found");
      }

      await Transaction.create([
        {
          userId: adminId,
          targetUserId: targetUser._id,
          type: "debit",
          amount,
          description: `Assigned to ${userEmail}`
        },
        {
          userId: targetUser._id,
          targetUserId: adminId,
          type: "credit",
          amount,
          description: "Assigned by admin"
        }
      ], { session, ordered: true });

      await session.commitTransaction();

      return res.json({
        message: "Credits assigned successfully",
        newAdminBalance: updatedAdmin.credits,
        targetUser
      });
    }

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();

    console.error("Credit Error:", err.message);

    let statusCode = 400;
    if (err.message.includes("AUTH")) statusCode = 403;
    if (err.message.includes("USER_ERROR")) statusCode = 404;

    res.status(statusCode).json({
      message: err.message.split(": ")[1] || "Credit operation failed"
    });

  } finally {
    session.endSession();
  }
};

exports.updateStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status } = req.body;

    // 1️⃣ Validate input
    if (!status) {
      throw new Error("Status is required");
    }

    // 🔥 Removed "completed" from allowed transitions
    const allowedTransitions = {
      pending: ["processing", "rejected"],
      processing: ["rejected"], // completion handled in /report
      completed: [],
      rejected: []
    };

    // 2️⃣ Fetch campaign inside session
    const campaign = await Campaign.findById(id).session(session);
    if (!campaign) {
      throw new Error("Campaign not found");
    }

    // 3️⃣ Prevent updates to locked states
    if (["completed", "rejected"].includes(campaign.status)) {
      throw new Error(`Campaign already ${campaign.status} and cannot be updated`);
    }

    // 4️⃣ Validate transition safely
    const possibleTransitions = allowedTransitions[campaign.status] || [];
    if (!possibleTransitions.includes(status)) {
      throw new Error(`Invalid transition from ${campaign.status} to ${status}`);
    }

    const creditAmount = campaign.phoneNumbers?.length || 0;

    // 5️⃣ Refund logic (only when moving TO rejected)
    if (status === "rejected") {
      const updatedUser = await User.findByIdAndUpdate(
        campaign.userId,
        { $inc: { credits: creditAmount } },
        { session, new: true }
      );

      if (!updatedUser) {
        throw new Error("User not found for refund");
      }

      await Transaction.create(
        [{
          userId: campaign.userId,
          targetUserId: campaign.userId,
          type: "credit",
          amount: creditAmount,
          description: "Refund: Campaign Rejected by Admin"
        }],
        { session }
      );
    }

    // 6️⃣ Update campaign status
    campaign.status = status;
    await campaign.save({ session });

    await session.commitTransaction();

    res.json(campaign);

  } catch (err) {

    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Update Status Error:", err.message);
    res.status(400).json({ message: err.message || "Status update failed" });

  } finally {
    session.endSession();
  }
};

exports.postStatusReport = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!req.file) {
      throw new Error("Report file is required");
    }

    const campaign = await Campaign.findById(id).session(session);
    if (!campaign) {
      throw new Error("Campaign not found");
    }

    if (campaign.status !== "processing") {
      throw new Error("Only processing campaigns can be completed");
    }

    const file = req.file;
    const fileExtension = file.originalname.split(".").pop();
    const fileName = `reports/${uuidv4()}.${fileExtension}`;

    const uploadParams = {
      Bucket: process.env.WASABI_BUCKET,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    await s3.send(new PutObjectCommand(uploadParams));

    const fileUrl = `https://s3.${process.env.WASABI_REGION}.wasabisys.com/${fileName}`;

    // ✅ Save report in campaign
    campaign.report = {
      fileUrl,
      fileKey: fileName,
      uploadedAt: new Date(),
      uploadedBy: req.user._id
    };

    campaign.status = "completed";

    await campaign.save({ session });

    await session.commitTransaction();

    res.json({
      message: "Campaign completed and report uploaded successfully",
      campaign
    });

  } catch (error) {

    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Report Upload Error:", error.message);
    res.status(400).json({ message: error.message });

  } finally {
    session.endSession();
  }
};

exports.getStatusReport = async (req, res) => {
  try {
    const fileKey = req.params[0] || req.params.fileKey;

    const command = new GetObjectCommand({
      Bucket: process.env.WASABI_BUCKET,
      Key: fileKey,
    });

    // 1. Get the data FROM Wasabi
    const s3Response = await s3.send(command);

    // 2. Prepare YOUR server's response headers
    res.setHeader("Content-Type", s3Response.ContentType || "application/pdf");
    res.setHeader("Content-Disposition", "inline");

    // 3. POUR the data from s3Response INTO res
    // You do NOT need res.send() here. pipe() handles the "sending".
    s3Response.Body.pipe(res);

  } catch (error) {
    console.error("Wasabi Fetch Error:", error.message);
    res.status(404).json({ message: "File not found" });
  }
};

exports.getAdminCreditHistory = async(req, res) => {
try {
  const userId = req.user.id

  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 5

  const search = req.query.search || ""
  const type = req.query.type || ""
  const sort = req.query.sort || "createdAt_desc"

  const skip = (page - 1) * limit

  let sortOptions = {}
  if (sort === "createdAt_desc") sortOptions={createdAt: -1} 
  if (sort === "createdAt_asc" ) sortOptions={createdAt:  1} 

  let matchStage = {};

    if (type) {
      matchStage.type = type;
    }
    if (userId){
      matchStage.userId = new mongoose.Types.ObjectId(userId);
    }

  const aggregationPipeline = [
  { $match: matchStage },
  {
    $lookup: {
      from: "users",
      localField: "targetUserId",
      foreignField: "_id",
      as: "user"
    }
  },
  { $unwind:  {
    path: "$user",
    preserveNullAndEmptyArrays: true
  } }
];

if (search) {
  aggregationPipeline.push({
    $match: {
      $or: [
        { "user.email": { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ]
    }
  });
}

 const totalResult = await Transaction.aggregate([
      ...aggregationPipeline,
      { $count: "total" }
    ]);

  const totalTransactions = totalResult[0]?.total || 0;
  const totalPages = Math.ceil(totalTransactions / limit);

  const history = await Transaction.aggregate([
    ...aggregationPipeline,
    { $sort: sortOptions },
    { $skip: skip },
    { $limit: limit }
  ]);

    return res.json({
      history,
      currentPage: page,
      totalPages,
      totalTransactions
    });
    
} catch (error) {
  console.error("Error while fetching the transaction history", error)
  return res.status(500).json({message:"Error while fetching transaction history"})
}
}

exports.getAllUserCampaigns = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const search = req.query.search || "";
    const status = req.query.status || "";
    const sort = req.query.sort || "createdAt_desc";
    const skip = (page - 1) * limit;

    let sortOptions = { createdAt: -1 };
    if (sort === "createdAt_asc") sortOptions = { createdAt: 1 };

    // 1. Build the initial filter (for fields directly on the Campaign)
    let matchStage = {};
    if (status) matchStage.status = status;

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: "users", // The name of your users collection
          localField: "userId",
          foreignField: "_id",
          as: "userDetails"
        }
      },
      { $unwind: "$userDetails" }
    ];

    // 2. Add SEARCH stage (Searches Title OR User Email OR User Name)
    if (search) {
      const safeSearch = _.escapeRegExp(search);
      pipeline.push({
        $match: {
          $or: [
            { "title": { $regex: safeSearch, $options: "i" } },
            { "userDetails.email": { $regex: safeSearch, $options: "i" } },
            { "userDetails.name": { $regex: safeSearch, $options: "i" } }
          ]
        }
      });
    }

    // 3. Use Facet for Count and Data
    const result = await Campaign.aggregate([
      ...pipeline,
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $sort: sortOptions },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                title: 1,
                status: 1,
                createdAt: 1,
                phoneNumbers: 1,
                userId: {
                  _id: "$userDetails._id",
                  name: "$userDetails.name",
                  email: "$userDetails.email",
                  credits: "$userDetails.credits"
                }
              }
            }
          ]
        }
      }
    ]);

    const totalCampaigns = result[0]?.metadata[0]?.total || 0;
    const campaigns = result[0]?.data || [];

    res.json({
      campaigns,
      totalCampaigns,
      totalPages: Math.ceil(totalCampaigns / limit),
      currentPage: page,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
          
exports.getCampaignDetails =  async (req, res) => {
            try {
              const { id } = req.params;
              // Find campaign by ID and ensure it belongs to the logged-in user
              if (req.user.role !== 'admin'){
                return res.status(403).json({ message: "Access Denied. This operation only made by ADMIN"})
              }
              const campaign = await Campaign.findOne({ _id: id});
          
              if (!campaign) {
                return res.status(404).json({ message: "Campaign not found" });
              }
          
              res.json(campaign);
            } catch (err) {
              console.error(err);
              res.status(500).json({ message: "Server error retrieving details" });
            }
};