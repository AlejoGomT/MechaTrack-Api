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

const getAdminId = async (req, res) => {
  try {
    const adminId = await userService.getAdminId();
    res.json({ id: adminId });
  } catch (error) {
    console.error(
      "[userController] Error al obtener ID del administrador:",
      error
    );
    res
      .status(error.message === "No se encontró un administrador" ? 404 : 500)
      .json({
        message: error.message || "Error al obtener ID del administrador",
      });
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

module.exports = {
  getUsers,
  getAdminId,
  createUser,
  updateUser,
  deleteUser,
  getUserById,
};
