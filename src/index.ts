import env from "./config/env";
import app from "../src/config/app";

app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});
