# Evidências visuais da tipografia Imprima

Capturas geradas em 18 de julho de 2026 pelo Chromium do Playwright `1.61.0`, a partir do servidor E2E isolado do Kairo.

- `landing-1440.png`: landing page em 1440 × 900 px.
- `autenticacao-375.png`: autenticação em 375 × 812 px.
- `aplicativo-1440.png`: Agenda autenticada em 1440 × 900 px.
- `aplicativo-zoom-200.png`: aplicativo com escala visual real de 200% via protocolo Chromium.

As capturas são reproduzíveis executando:

```powershell
$env:KAIRO_CAPTURAR_EVIDENCIAS_TIPOGRAFICAS='1'
npx playwright test tests/e2e/kairo-tipografia-imprima.spec.js --project=chromium-desktop --grep "reflow, foco"
Remove-Item Env:KAIRO_CAPTURAR_EVIDENCIAS_TIPOGRAFICAS
```

O teste também valida seis larguras, foco visível, ausência de overflow global e reflow equivalente a 1440 px com zoom de 200%.
