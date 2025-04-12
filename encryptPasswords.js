const bcrypt = require("bcrypt");
const pool = require("./src/config/database");

const encryptPasswords = async () => {
  const users = [
    { id: "U001", password: "admin123" },
    { id: "U002", password: "tech123" },
    { id: "U003", password: "sec123" },
    { id: "U004", password: "client123" },
  ];

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      user.id,
    ]);
    console.log(`Contraseña de ${user.id} encriptada`);
  }
  await pool.end();
};

encryptPasswords().catch((err) => console.error(err));
