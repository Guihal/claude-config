/**
 * Шаблон. Копируется в проект руками, расширение его не навязывает.
 * Требует: npm i -D stylelint stylelint-declaration-strict-value
 * Расширение .mjs — export default читается и в проектах без "type": "module".
 *
 * Всё из списка ниже — только через var(--*). Нестандартный отступ = новый токен
 * в шкале tokens.css, а не литерал в правиле.
 */
export default {
  plugins: ["stylelint-declaration-strict-value"],
  rules: {
    "scale-unlimited/declaration-strict-value": [
      [
        "color",
        "background-color",
        "border-color",
        "font-size",
        "font-family",
        "z-index",
        "border-radius",
        "box-shadow",
        "padding",
        "margin",
        "gap",
      ],
      {
        ignoreValues: ["transparent", "inherit", "currentColor", "0", "none", "auto"],
        // default true пропускает rgb()/calc() мимо правила — литерал в функции тот же литерал
        ignoreFunctions: false,
        disableFix: true,
      },
    ],
  },
};
