const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { restrictTo } = require("../middleware/role");
const verifyToken = require("../middleware/auth");

router.use(verifyToken);
router.use(restrictTo("admin"));

router.get("/", userController.getUsers);
router.post("/", userController.createUser);
router.get("/:id", userController.getUserById);
router.put("/:id", userController.updateUser);
router.delete("/:id", userController.deleteUser);

module.exports = router;
