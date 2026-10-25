const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254
    },
    password: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: ["student", "instructor", "admin"],
      required: true
    }
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform: (document, returnedUser) => {
    delete returnedUser.password;
    delete returnedUser.__v;
  }
});

module.exports = mongoose.model("User", userSchema);
