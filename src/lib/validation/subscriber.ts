import { z } from "zod";
import { emailField, localeField } from "./shared";

export const subscriberSchema = z.object({
  email: emailField,
  locale: localeField,
});

export type SubscriberInput = z.infer<typeof subscriberSchema>;
