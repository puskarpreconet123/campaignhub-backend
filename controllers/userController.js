const Campaign = require("../models/Campaign");
const User = require("../models/User")
const Transaction = require("../models/Transaction");
const { default: mongoose } = require("mongoose");
const _ = require('lodash'); // Ensure lodash is imported

exports.getDashboard = async (req, res) => {
  res.json({ msg: "User dashboard data" });
};

exports.campaignHistory = async (req, res) => {
  try {
    // 1. Parse Query Parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const search = req.query.search || "";
    const status = req.query.status || "";
    const sort = req.query.sort || "createdAt_desc";
    const skip = (page - 1) * limit;

    // 2. Setup Sorting
    let sortOptions = { createdAt: -1 };
    if (sort === "createdAt_asc") sortOptions = { createdAt: 1 };

    // 3. Build Initial Filter (Strictly for the current user)
    let matchStage = { userId: new mongoose.Types.ObjectId(req.user.id) };
    if (status) matchStage.status = status;

    // 4. Build Pipeline
    const pipeline = [
      { $match: matchStage }
    ];

    // 5. Add Search functionality (Title search)
    if (search) {
      const safeSearch = _.escapeRegExp(search);
      pipeline.push({
        $match: {
          title: { $regex: safeSearch, $options: "i" }
        }
      });
    }

    // 6. Execute Aggregation with Facets for Metadata and Data
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
                // Add any other specific fields you need here
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
    console.error("History Fetch Error:", err);
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
  try {
    const userId = req.user.id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;

    // FIX 1: Corrected typo 'req.quey' to 'req.query'
    const search = req.query.search || "";
    const type = req.query.type || "";
    const sort = req.query.sort || "createdAt_desc";

    const skip = (page - 1) * limit;

    let sortOptions = { createdAt: -1 };
    if (sort === "createdAt_asc") sortOptions = { createdAt: 1 };

    let matchStage = {};
    if (type) matchStage.type = type;
    if (userId) matchStage.userId = new mongoose.Types.ObjectId(userId);

    // Initial Pipeline
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
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    // Search filter
    if (search) {
      const escapedSearch = _.escapeRegExp(search);
      aggregationPipeline.push({
        $match: {
          $or: [
            { "user.email": { $regex: escapedSearch, $options: "i" } },
            { "description": { $regex: escapedSearch, $options: "i" } }
          ]
        }
      });
    }

    // FIX 2: Use $facet to get Total Count AND Data in ONE database call
    // This is much more efficient than running the aggregate twice.
    const result = await Transaction.aggregate([
      ...aggregationPipeline,
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $sort: sortOptions },
            { $skip: skip },
            { $limit: limit }
          ]
        }
      }
    ]);

    const totalTransactions = result[0]?.metadata[0]?.total || 0;
    const history = result[0]?.data || [];
    const totalPages = Math.ceil(totalTransactions / limit);

    return res.json({
      history,
      currentPage: page,
      totalPages,
      totalTransactions
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error" });
  }
};