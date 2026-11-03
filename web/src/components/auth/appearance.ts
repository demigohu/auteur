/** Clerk's sign-in, sign-up and account screens dressed in Auteur's paper, ink and lime (docs/DESIGN.md). */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#121110",
    colorPrimaryForeground: "#c8f53c",
    colorBackground: "#f2eee3",
    colorForeground: "#121110",
    colorMutedForeground: "rgb(18 17 16 / 0.6)",
    colorInput: "#fbf9f4",
    colorInputForeground: "#121110",
    colorDanger: "#e2380b",
    colorSuccess: "#1f7a3f",
    colorBorder: "#121110",
    colorRing: "#ff4f1f",
    fontFamily: "var(--font-inter-tight), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-inter-tight), system-ui, sans-serif",
    borderRadius: "14px",
  },
  elements: {
    cardBox: "rounded-[22px] border-2 border-ink shadow-[10px_10px_0_0_var(--lime)]",
    headerTitle: "font-display uppercase text-[28px] leading-none tracking-normal",
    formButtonPrimary: "rounded-full border-2 border-ink shadow-[0_3px_0_0_var(--ink)] font-semibold normal-case",
    socialButtonsBlockButton: "rounded-full border-2 border-ink",
    formFieldInput: "border-2 border-ink/25 focus:border-ink",
    footerActionLink: "font-semibold text-ink underline decoration-tomato decoration-2 underline-offset-4",
  },
};
