# Guía del proyecto

## Objetivo

Construir una extensión GNOME Shell compatible con GNOME 50 y versiones posteriores, que presente uso y límites/cuotas de proveedores de IA en el panel superior. Antes de implementar proveedores, documenta la fuente de datos, credenciales requeridas, métricas, límites y manejo de errores de cada uno en `docs/definition.md`.

## Fuentes de referencia

- `agtop/`: lógica de consumo por sesión y consultas actuales de cuotas. Es un checkout de referencia con modificaciones locales; no alteres sus archivos como parte del trabajo del producto sin una solicitud explícita.
- `gnome-system-monitor-indicator/`: patrón de extensión GNOME Shell, ciclo de vida, actualización, preferencias y GSettings. Conserva su rol de referencia.
- La extensión nueva pertenece a la raíz de este repositorio; no la mezcles dentro de ninguno de los dos checkouts.

## Diseño y convenciones

- Usa GJS y las APIs públicas de GNOME Shell. Comprueba compatibilidad en GNOME 50+ antes de fijar imports o APIs.
- Mantén el trabajo de red y lectura de credenciales fuera del camino síncrono del Shell. Controla concurrencia, timeout, caché, errores y cancelación en `disable()`.
- No muestres ni registres tokens, secretos o respuestas completas que puedan incluir datos sensibles. Minimiza la lectura de credenciales y limita cada integración a su proveedor.
- Para cuotas, utiliza únicamente interfaces públicas/documentadas y autorizadas. No portes los endpoints de cuota no documentados de agtop ni reutilices OAuth de Gemini CLI/Code Assist para consultar sus backends.
- Codex con plan ChatGPT es requisito del primer lanzamiento personal/experimental. Usar `account/rateLimits/read` del Codex App Server por stdio. No leer `~/.codex/auth.json` ni llamar `chatgpt.com/backend-api/wham/usage`; tampoco usar scraping o automatización de UI. Comunicar que App Server está marcado experimental y no soportado para producción; aislar su adaptador y no presentarlo como integración estable de producción.
- Modela por separado uso observado en sesiones (tokens/costo) y cuotas del plan (porcentaje restante, ventana y reinicio); no los presentes como equivalentes.
- Guarda preferencias en un schema GSettings y configura su interfaz mediante las APIs de preferencias compatibles con GNOME 50+.
- Los datos no disponibles o autenticación vencida deben producir un estado comprensible, sin bloquear el panel ni ocultar el estado de otros proveedores.

## Cambios en los repos de referencia

Antes de editar cualquier repo anidado, revisa su estado Git. Preserva los cambios locales existentes, en particular los de `agtop/`. No restaures, limpies ni reformatees checkouts de referencia.

## Validación

La validación de la extensión debe incluir comprobación de metadatos/schema, instalación local, habilitar/deshabilitar sin errores y revisión en GNOME 50+. Añade o ejecuta pruebas solo cuando la tarea pida verificar la implementación; informa claramente cualquier validación manual pendiente.
