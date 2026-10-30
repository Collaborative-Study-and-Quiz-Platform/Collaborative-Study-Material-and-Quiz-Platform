const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

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

userSchema.pre("save", async function hashPasswordBeforeSave() {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

module.exports = mongoose.model("User", userSchema);
