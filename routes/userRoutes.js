const router = require("express").Router();
const auth = require("../middleware/auth");
const { 
  getDashboard, 
  campaignHistory, 
  getCampaignById ,// Import the new controller function
  getUserDetails,
  getUserCreditHistory,
} = require("../controllers/userController");
const { getCampaignMedia } = require("../controllers/campaignController")

router.get("/dashboard", auth, getDashboard);
router.get("/campaign", auth, campaignHistory);
router.get("/campaign/:id", auth, getCampaignById);
router.get("/transactions", auth, getUserCreditHistory);

router.get("/profile", auth, getUserDetails);

router.get("/campaign/:campaignId/media/:mediaId", auth, getCampaignMedia);

module.exports = router;