const Campaign = require("../models/Campaign");
const User = require("../models/User")
const Transaction = require("../models/Transaction")

exports.getDashboard = async (req, res) => {
  res.json({ msg: "User dashboard data" });
};

exports.campaignHistory = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

    res.json(campaigns);

  } catch (err) {
    res.status(500).json({ message: "Failed to fetch campaigns" });
  }
};

exports.getCampaignById = async (req, res) => {
  try {
    const { id } = req.params;

    // Find campaign by ID and ensure it belongs to the logged-in user
    const campaign = await Campaign.findOne({ _id: id, userId: req.user.id });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    res.json(campaign);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error retrieving details" });
  }
};
 
exports.getUserDetails = async (req, res) => {
  try {
    // We use .select("-password") so we don't send the hashed password to the browser
    const user = await User.findById(req.user.id).select("-password -__v");
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Profile Error:", err.message);
    res.status(500).json({ message: "Server error while fetching profile" });
  }
}

exports.getUserCreditHistory = async (req, res) => {
  const history = await Transaction.find({ userId: req.user.id })
    .sort({ createdAt: -1 }) // Newest transactions first
    .limit(50); // Keep it fast by limiting the result
  const userName = await User.findById(req.user.id ).select("email credits")
  return res.json({history, userName});
};