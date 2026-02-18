const router = require("express").Router();
const auth = require("../middleware/auth");
const role = require("../middleware/role");
const uploadToWasabi = require("../middleware/uploadToWasabi")
const { createUser, addCredits, getAllUserCampaigns, updateStatus, getAdminCreditHistory, getCampaignDetails, postStatusReport, getStatusReport } = require("../controllers/adminController");

router.post("/create-user", auth, role("admin"), createUser);
router.post("/add-credits", auth, role("admin"), addCredits);
router.get("/all-campaigns", auth, role("admin"), getAllUserCampaigns);
router.get("/transactions", auth, role("admin"), getAdminCreditHistory);

router.get("/campaign/:id", auth, role("admin"), getCampaignDetails);
router.patch("/campaign/:id/status", auth, role("admin"), updateStatus);
router.post("/campaign/:id/report", auth, role("admin"), uploadToWasabi.single("file"), postStatusReport);
router.get("/statusFile/:fileKey", auth, role("admin"), getStatusReport);
module.exports = router;
