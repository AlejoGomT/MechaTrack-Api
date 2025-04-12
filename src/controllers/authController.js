const authService = require("../services/authService");

const login = async (req, res) => {
  const { id, password } = req.body;
  try {
    const { token, user } = await authService.login(id, password);
    res.json({ token, user });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

const verifyToken = async (req, res) => {
  try {
    const user = await authService.verifyToken(req.user.id);
    res.json({ user });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

module.exports = { login, verifyToken };
