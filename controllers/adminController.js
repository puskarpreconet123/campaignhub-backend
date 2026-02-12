const { json } = require("express");
const User = require("../models/User");
const Campaign = require("../models/Campaign");

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
  try {
    const { userId, credits } = req.body;

    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin only action" });
    }

    // 1. Check if admin has enough credits
    const adminCheck = await User.findById(req.user.id);
    if (adminCheck.credits < credits) {
      return res.status(400).json({ message: "Insufficient credits" });
    }

    // 2. Deduct from Admin and get the NEW balance
    const updatedAdmin = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { credits: -credits } },
      { new: true } // Return the document AFTER update
    );

    // 3. Add to the target user
    const targetUser = await User.findOneAndUpdate(
      { email: userId },
      { $inc: { credits: credits } },
      { new: true }
    );

    if (!targetUser) {
      // Rollback admin credits if user not found (Optional but recommended)
      await User.findByIdAndUpdate(req.user.id, { $inc: { credits: credits } });
      return res.status(404).json({ message: "Target user not found" });
    }

    // 4. Return both objects so the UI can update
    res.json({
      message: "Credits assigned successfully",
      newAdminBalance: updatedAdmin.credits,
      targetUser: targetUser
    });

  } catch (err) {
    console.log("error while add credits :",err);                 // shows full error in terminal
  res.status(500).json({
    message: err.message,
    error: err
  });;
    res.status(500).json({ message: "Something went wrong" });
  }
};

exports.getAllUserCampaigns = async (req, res) => {
  try {
    // Find all users who are NOT admins, and pull in their campaigns
    const users = await User.find({ role: 'user' }).lean();
    
    // For each user, find their campaigns
    const usersWithCampaigns = await Promise.all(users.map(async (user) => {
      const campaigns = await Campaign.find({ userId: user._id }).sort({ createdAt: -1 });
      return { ...user, campaigns };
    }));

    res.json(usersWithCampaigns);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 1. Find the campaign first to check its current data
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    // 2. Logic for Refund: If status is being changed to 'rejected'
    // and it wasn't already rejected (to prevent double refunds)
    if (status === "rejected" && campaign.status !== "rejected") {
      const refundAmount = campaign.phoneNumbers.length;

      await User.findByIdAndUpdate(campaign.userId, {
        $inc: { credits: refundAmount } // Use $inc to safely increment the value
      });
      
      console.log(`Refunded ${refundAmount} credits to user ${campaign.userId}`);
    }
    else if(status !== "rejected" && campaign.status === "rejected"){
      const reductAmount = campaign.phoneNumbers.length;
      await User.findByIdAndUpdate(campaign.userId, {
        $inc: {credits: -reductAmount}
      }, {new: true})
      console.log(`Reducted ${reductAmount} credits from user ${campaign.userId}`);
    }

    // 3. Update the campaign status
    campaign.status = status;
    await campaign.save();

    res.json(campaign);
  } catch (err) {
    console.error("Update Status Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

