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
