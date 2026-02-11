const Campaign = require("../models/Campaign");

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
