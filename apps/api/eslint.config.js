import base from "@hp/config/eslint";

// API-only additions on top of the shared config.
export default [
  ...base,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Raw errors can carry emails, SMTP recipients and Prisma/Stripe values in their
          // message; log safeErrorFields(err) instead.
          selector:
            "CallExpression[callee.object.name='logger'] ObjectExpression > Property[key.name='err'][value.type='Identifier']",
          message: "Log `err: safeErrorFields(err)`, never the raw error.",
        },
      ],
    },
  },
];
