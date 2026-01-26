import jwt from "jsonwebtoken";

let SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production");
  }
  SECRET = "dev-secret-change-me";
  console.warn("JWT_SECRET missing, using dev fallback");
}

export function createToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "14d" });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
