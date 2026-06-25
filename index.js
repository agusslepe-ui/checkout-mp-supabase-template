require("dotenv").config();

const { PORT } = require("./src/config");
const { app } = require("./src/app");
const { log } = require("./src/logger");

app.listen(PORT, () => {
  log("info", "servidor iniciado", {
    request_id: "startup",
    route: "startup",
    method: "STARTUP",
  });
});
