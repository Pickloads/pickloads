import { z } from "zod";
import {
  emailField,
  localeField,
  optionalPhoneField,
  optionalText,
} from "./shared";

export const contactMessageSchema = z.object({
  full_name: optionalText(120),
  email: emailField,
  phone: optionalPhoneField,
  subject: optionalText(200),
  body: z
    .string()
    .trim()
    .min(10, "Tell us a little more — at least 10 characters.")
    .max(5000, "Message is too long (5,000 characters max)."),
  locale: localeField,
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
