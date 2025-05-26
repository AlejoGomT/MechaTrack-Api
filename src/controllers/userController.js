const userService = require("../services/userService");

const getUsers = async (req, res, next) => {
  try {
    const { name, role, page, limit, excludeAdmin } = req.query;
    const users = await userService.getUsers({
      name,
      role,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      excludeAdmin: excludeAdmin === "true",
    });
    res.json(users);
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    await userService.deleteUser(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

const getUserByRole = async (req, res, next) => {
  try {
    const { role } = req.params;
    const user = await userService.getUserByRole(role);
    res.json(user);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserById,
  getUserByRole,
};
