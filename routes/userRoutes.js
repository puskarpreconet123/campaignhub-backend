const router = require("express").Router();
const auth = require("../middleware/auth");
const { 
  getDashboard, 
  campaignHistory, 
  getCampaignById ,// Import the new controller function
  getUserDetails
} = require("../controllers/userController");

router.get("/dashboard", auth, getDashboard);
router.get("/campaign", auth, campaignHistory);

// New route for fetching a single campaign's details
router.get("/campaign/:id", auth, getCampaignById);

// GET /api/user/profile
// Fetches the logged-in user's data (credits, etc.)
router.get("/profile", auth, getUserDetails);

module.exports = router;