const router = require("express").Router();
const auth = require("../middleware/auth");
const { getDashboard, campaignHistory } = require("../controllers/userController");

router.get("/dashboard", auth, getDashboard);
router.get("/campaign", auth, campaignHistory);

module.exports = router;
