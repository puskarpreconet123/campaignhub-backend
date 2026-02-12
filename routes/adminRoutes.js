const router = require("express").Router();
const auth = require("../middleware/auth");
const role = require("../middleware/role");
const { createUser, addCredits, getAllUserCampaigns, updateStatus } = require("../controllers/adminController");

router.post("/create-user", auth, role("admin"), createUser);
router.post("/add-credits", auth, role("admin"), addCredits);
router.get("/all-campaigns", auth, role("admin"), getAllUserCampaigns);
// routes/adminRoutes.js
router.patch("/campaign/:id", auth, role("admin"), updateStatus);
module.exports = router;
