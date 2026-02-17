const router = require("express").Router();
const auth = require("../middleware/auth");
const { 
  getDashboard, 
  campaignHistory, 
  getCampaignById ,// Import the new controller function
  getUserDetails,
  getUserCreditHistory
} = require("../controllers/userController");

router.get("/dashboard", auth, getDashboard);
router.get("/campaign", auth, campaignHistory);
router.get("/campaign/:id", auth, getCampaignById);
router.get("/transactions", auth, getUserCreditHistory);

router.get("/profile", auth, getUserDetails);

module.exports = router;