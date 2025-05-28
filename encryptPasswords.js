const bcrypt = require("bcryptjs");
const pool = require("./src/config/database");

const encryptPasswords = async () => {
  const users = [
    { id: "U001", email: "halejandrogt@hotmail.com", password: "admin123" },
    { id: "U002", email: "alejogomezt2000@gmail.com", password: "tech123" },
    {
      id: "U003",
      email: "alejandro.gomezt@uqvirtual.edu.co",
      password: "sec123",
    },
    {
      id: "U004",
      email: "alejandro.gomezt.businnes@gmail.com",
      password: "client123",
    },
  ];

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    await pool.query(
      "UPDATE users SET password = $1, email = $2 WHERE id = $3",
      [hashedPassword, user.email, user.id]
    );
    console.log(`Contraseña y email de ${user.id} actualizados`);
  }
  await pool.end();
};

encryptPasswords().catch((err) => console.error(err));
