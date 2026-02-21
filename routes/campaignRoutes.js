const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const upload = require("../middleware/upload");
const campaignController = require("../controllers/campaignController");

router.post(
  "/create",
  auth,
  upload,
  campaignController.createCampaign
);

module.exports = router;
