const { json } = require("express");
const User = require("../models/User");
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction")
const mongoose = require("mongoose")

exports.createUser = async (req, res) => {
  const { name, email, password } = req.body;
  const bcrypt = require("bcryptjs");

  const hashed = await bcrypt.hash(password, 10);

  const user = await User.create({
    name,
    email,
    password: hashed,
    role: "user"
  });

  res.json(user);
};

exports.addCredits = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId, credits } = req.body;
    const adminId = req.user.id;
    const amount = Math.abs(credits); // The actual number to move

    if (!req.user || req.user.role !== "admin") {
      throw new Error("AUTH_DENIED: Admin only action");
    }

    // Determine the direction of the transaction
    const isReduction = credits < 0;

    if (isReduction) {
      /** * CONDITION: REMOVING CREDITS FROM USER
       * Admin gets credits BACK (+), User LOSES credits (-)
       */
      const updatedUser = await User.findOneAndUpdate(
        { email: userId, credits: { $gte: amount } }, // Ensure user has enough to be deducted
        { $inc: { credits: -amount } },
        { session, new: true }
      ).select("-password");

      if (!updatedUser) throw new Error("USER_ERROR: User has insufficient credits or not found");

      const updatedAdmin = await User.findByIdAndUpdate(
        adminId,
        { $inc: { credits: amount } },
        { session, new: true }
      );

      await Transaction.create([
        { userId: adminId, targetUserId: updatedUser._id, type: 'credit', amount, description: `reduct from user` },
        { userId: updatedUser._id, targetUserId: adminId,  type: 'debit', amount, description: `reducted by admin` }
      ], { session, ordered: true });

      await session.commitTransaction();
      return res.json({ message: "Credits reduced successfully", newAdminBalance: updatedAdmin.credits, targetUser: updatedUser });

    } else {
      /** * CONDITION: ADDING CREDITS TO USER (Original Logic)
       * Admin LOSES credits (-), User GAINS credits (+)
       */
      const updatedAdmin = await User.findOneAndUpdate(
        { _id: adminId, credits: { $gte: amount } },
        { $inc: { credits: -amount } },
        { session, new: true }
      );

      if (!updatedAdmin) throw new Error("CREDIT_ERROR: Admin has insufficient credits");

      const targetUser = await User.findOneAndUpdate(
        { email: userId },
        { $inc: { credits: amount } },
        { session, new: true }
      ).select("-password");

      if (!targetUser) throw new Error("USER_ERROR: Target user not found");

      await Transaction.create([
        { userId: adminId, targetUserId: targetUser._id, type: 'debit', amount, description: `Assigned to ${userId}` },
        { userId: targetUser._id, targetUserId: adminId, type: 'credit', amount, description: `Assigned by admin` }
      ], { session, ordered: true });

      await session.commitTransaction();
      return res.json({ message: "Credits assigned successfully", newAdminBalance: updatedAdmin.credits, targetUser });
    }

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Credit Error:", err);
    let statusCode = err.message.includes("AUTH_DENIED") ? 403 : err.message.includes("USER_ERROR") ? 404 : 400;
    res.status(statusCode).json({ message: err.message.split(": ")[1] || "Something went wrong" });
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

    // Use session even for the initial find to ensure consistency
    const campaign = await Campaign.findById(id).session(session);
    if (!campaign) {
      throw new Error("Campaign not found");
    }

    const creditAmount = campaign.phoneNumbers.length;

    // CASE A: Refunding (Pending/Processing -> Rejected)
    if (status === "rejected" && campaign.status !== "rejected") {
      await User.findByIdAndUpdate(
        campaign.userId, 
        { $inc: { credits: creditAmount } },
        { session } // CRITICAL: Link to session
      );

      await Transaction.create([{
        userId: campaign.userId,
        targetUserId: campaign.userId,
        type: 'credit', // In your system 'credit' = refund/plus
        amount: creditAmount,
        description: `Refund: Campaign Rejected by Admin`,
      }], { session });

      console.log(`Refunded ${creditAmount} credits`);
    } 
    
    // CASE B: Re-deducting (Rejected -> Pending/Processing/Completed)
    else if (status !== "rejected" && campaign.status === "rejected") {
      // Safety Check: Does the user have enough credits to "un-reject" this?
      const user = await User.findById(campaign.userId).session(session);
      if (user.credits < creditAmount) {
        throw new Error("User has insufficient credits to reactivate this campaign.");
      }

      await User.findByIdAndUpdate(
        campaign.userId, 
        { $inc: { credits: -creditAmount } },
        { session }
      );

      await Transaction.create([{
        userId: campaign.userId,
        targetUserId: campaign.userId,
        type: 'debit', // In your system 'debit' = deduction/minus
        amount: creditAmount,
        description: `Deduction: Campaign Reactivated by Admin`,
      }], { session });

      console.log(`Deducted ${creditAmount} credits`);
    }

    // 3. Update campaign
    campaign.status = status;
    await campaign.save({ session }); // CRITICAL: Link to session

    await session.commitTransaction();
    res.json(campaign);

  } catch (err) {
    await session.abortTransaction();
    console.error("Update Status Error:", err.message);
    res.status(400).json({ message: err.message || "Server error" });
  } finally {
    session.endSession();
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
          // retrieving all filters from query
          const page = parseInt(req.query.page) || 1;
          const limit = parseInt(req.query.limit) || 5;
          
          const search = req.query.search || "";
          const status = req.query.status || "";
          const sort = req.query.sort || "createdAt_desc";
      
          // applying pagination logic
          const skip = (page - 1) * limit;
      
          let filter = {};
      
          if (search) {
            filter.title = { $regex: search, $options: "i" };
          }
      
          if (status) {
            filter.status = status;
          }
      
          let sortOptions = {};
          if (sort === "createdAt_desc") sortOptions = { createdAt: -1 };
          if (sort === "createdAt_asc" ) sortOptions = { createdAt:  1 };
      
          // paginated + populated + optimized query
          const campaigns = await Campaign.find(filter)
            .populate("userId", "name email credits")
            .sort(sortOptions)
            .skip(skip)
            .limit(limit)
            .lean();
      
          // total count for pagination
          const totalCampaigns = await Campaign.countDocuments(filter);
      
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