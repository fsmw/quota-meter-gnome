# Definición inicial de agnome-top

## Propósito

Mostrar en la barra superior de GNOME Shell el estado de uso y las cuotas de proveedores de IA (por ejemplo, Codex, Claude y Gemini), con acceso a un detalle compacto por proveedor. El primer objetivo de plataforma es GNOME Shell 50 y versiones posteriores.

## Qué aportan las referencias

| Referencia | Evidencia útil | Límite para este proyecto |
|---|---|---|
| `agtop/index.js` | Lee sesiones locales de agentes; estima o acumula tokens/costos. La sección de cuotas consulta Claude OAuth (`api.anthropic.com/api/oauth/usage`), Codex (`chatgpt.com/backend-api/wham/usage`) y saldo DeepSeek (`api.deepseek.com/user/balance`). Normaliza ventanas, porcentajes, reinicios, plan y saldos. | Es una aplicación Node.js de terminal, no una extensión GNOME. Sus endpoints, archivos de credenciales y supuestos de autenticación deben revalidarse antes de reutilizarlos. La referencia no implementa Gemini. El uso por sesión y la cuota de cuenta son conceptos distintos. |
| `gnome-system-monitor-indicator/src/extension.js` | Usa `Extension`, `PanelMenu.Button`, `Main.panel.addToStatusArea`, actores `St`, refresco con GLib y limpieza en `destroy()`/`disable()`. Evita solapar actualizaciones y cancela lecturas pendientes. | Lee archivos locales de `/proc`; no proporciona un patrón de red ni de manejo de secretos. Sus preferencias cubren métricas simples, no proveedores. |
| `gnome-system-monitor-indicator/src/prefs.js`, `src/schemas/` y `src/metadata.json` | Preferencias con Adw/Gtk y claves GSettings; metadata declara compatibilidad con Shell 45–51. | La extensión nueva debe declarar GNOME 50+ y revisar APIs actuales; no copiar el rango antiguo automáticamente. |

## Modelo funcional

La interfaz debe distinguir claramente estas medidas:

1. **Cuota del proveedor**: límite/uso reportado por el proveedor, indicando la ventana (por ejemplo, 5 horas o 7 días), porcentaje usado o restante y hora de reinicio si existe.
2. **Uso observado localmente**: tokens o costo agregado desde sesiones/transcripciones disponibles en el equipo. Puede ser incompleto y no equivale al medidor oficial de cuota.
3. **Saldo de API**: balance monetario cuando el proveedor expone una API separada, como el caso DeepSeek identificado en agtop.

No mezclar ni sumar estas medidas en un único “límite restante”. Cada proveedor publica capacidades diferentes; campos ausentes deben quedar como “no disponible”. La barra debe mantener la información breve y permitir consultar detalles en un menú desplegable.

## Arquitectura propuesta

- **Extensión GNOME Shell (GJS/ES modules)**: punto de entrada, indicador de panel, menú de detalle, preferencias y ciclo de vida.
- **Adaptadores por proveedor**: una interfaz común que devuelve datos normalizados y metadatos de disponibilidad; cada adaptador conoce su fuente, autenticación, límites y esquema.
- **Coordinador de actualización**: refresco asíncrono de baja frecuencia, caché por proveedor, timeout, control de solicitudes duplicadas y cancelación/descarte de resultados al deshabilitar la extensión.
- **Preferencias**: proveedores habilitados, intervalo razonable, formato/elementos visibles y configuración no secreta mediante GSettings.
- **Errores parciales**: fallo o credencial ausente de un proveedor no debe afectar a los demás; mostrar última actualización y estado de error sin volcar secretos a logs.

La extensión se ejecuta dentro del proceso de GNOME Shell. Por tanto, ninguna lectura de disco, red o parseo pesado debe bloquear el hilo principal. Antes de seleccionar el mecanismo de red y almacenamiento de tokens, verificar APIs soportadas por GNOME 50 y evitar invocar `agtop` como proceso dependiente.

## Productos y ficha por proveedor

“Proveedor” debe identificar un producto y una cuenta concretos. Cuotas de suscripción, límites de API, saldo monetario y uso local no son intercambiables.

| Integración | Fuente/credencial que agtop usa o fuente oficial identificada | Datos y semántica | Estado/recomendación |
|---|---|---|---|
| **Codex con plan ChatGPT** | Interfaz oficial identificada: `account/rateLimits/read` del Codex App Server, accesible por JSON-RPC sobre stdio (`codex app-server`). No extraer el token de `~/.codex/auth.json` ni llamar directamente a `chatgpt.com/backend-api/wham/usage`. | La respuesta expone buckets de límites, porcentaje usado, duración de ventana y reinicio, tipo de plan y créditos cuando correspondan. | **Obligatorio para v1 personal/experimental.** App Server está marcado experimental y no soportado para producción; aislarlo tras un adaptador y comunicar su limitación. |
| **OpenAI API Platform** | API key del usuario/proyecto u organización; no es la misma identidad ni cuota que el plan ChatGPT de Codex. OpenAI documenta límites API por modelo/org/proyecto y los headers de respuestas de inferencia pueden incluir remaining/rate-limit metadata. | RPM/TPM y otros límites de API; no representan el allowance del plan personal de Codex. Una API key tampoco debe asumirse capaz de consultar el uso de Codex del plan ChatGPT. | **Fuera de v1** para mantener el producto Codex claramente delimitado. Evaluar luego como conector distinto `openai-api`. |
| **Claude Code con plan Claude** | agtop lee credenciales OAuth de Claude Code y llama `api.anthropic.com/api/oauth/usage` ([código](../agtop/index.js#L3207), [consulta](../agtop/index.js#L3325)). Anthropic confirma que Claude y Claude Code comparten límites Pro/Max; no encontré documentado el endpoint OAuth de cuota como API pública. | `five_hour`, `seven_day`, ventanas por modelo, extra usage, plan y reinicios cuando estén disponibles. | **Sin cuota en v1**: no portar el endpoint OAuth de agtop. Sí puede mostrarse uso local observado de sesiones Claude Code. |
| **Anthropic Console/API** | La API Admin oficial usa una Admin API key y endpoints de informes de uso/costo de organizaciones. | Informa tokens/costos por buckets, workspace, modelo o API key; no equivale a cuota restante de Claude Pro/Max. La Admin key requiere privilegios organizacionales más amplios que un token de uso normal. | **Fuera de v1**: otra identidad, privilegio y métrica. Evaluar como conector separado solo si el usuario lo solicita. |
| **Gemini CLI / Code Assist / Google AI Pro o Ultra** | Gemini CLI documenta `/stats model` como vista local de uso/cuota. Google indica que desde el 18 de junio de 2026 dejó de servir niveles de consumidor en CLI y que herramientas de terceros no deben reutilizar su OAuth para acceder a Code Assist. | La CLI muestra estadísticas para su servicio, pero no habilita a esta extensión a llamar al backend con OAuth de la CLI. Plan web Gemini y cuotas CLI/API son productos distintos. | **Fuera de v1**: no leer ese OAuth ni acceder al backend. |
| **Gemini Developer API / AI Studio** | API key vinculada a un proyecto; la guía oficial indica revisar límites activos en AI Studio. | RPM, TPM de entrada y RPD por proyecto/modelo; el RPD reinicia a medianoche del Pacífico. No es la cuota de Google AI Pro/Ultra. No quedó identificada una API pública para sincronizar todos los límites activos. | **Fuera de v1**; estudiar luego como integración distinta. |
| **DeepSeek API** | agtop usa `DEEPSEEK_API_KEY` para consultar el balance oficial del API (`/user/balance`; [código](../agtop/index.js#L3405)). | Saldo disponible en moneda, no tokens usados ni cuota restante de una suscripción de agente. | **Fuera de v1 propuesta**; sumar después como tipo de métrica `balance` si se confirma interés. |

### Ficha operativa de Codex v1

| Campo | Definición |
|---|---|
| Producto cubierto | Allowance de Codex asociado a la cuenta del plan ChatGPT que ya usa Codex CLI; no límites ni facturación de OpenAI API Platform. |
| Fuente | Codex App Server oficial, iniciado como subproceso con `codex app-server` y transporte stdio. JSON-RPC `account/rateLimits/read`; admitir `account/rateLimits/updated` si el ciclo de protocolo lo requiere. |
| Credencial y ubicación | La autenticación permanece a cargo de Codex CLI/App Server y su sesión local. La extensión no abre ni parsea `~/.codex/auth.json`, no guarda tokens en GSettings y no los pasa como argumentos o entorno. La falta de sesión se refleja como `auth_required`. |
| Datos/unidades | Para cada bucket preservar `usedPercent` tal como se define en protocolo, `windowDurationMins`, `resetsAt`, `planType` y créditos opcionales. Convertir a porcentaje restante solo como `100 - usedPercent`, únicamente si la respuesta es numérica y está en el rango válido; no inventar un límite absoluto de tokens. |
| Ventanas y reinicio | La respuesta determina los buckets, duración y epoch de reinicio. No asumir que siempre habrá exactamente una ventana corta y otra semanal. Guardar instante de recepción UTC y derivar la hora local solo para presentación. |
| Frecuencia y límites | Sondeo base cada 5 min según política global; evitar llamadas concurrentes. No se ha identificado un límite de consulta publicado: no sondear por debajo de 5 min y aplicar caché/backoff local. Revalidar política antes de publicar. |
| Errores | Distinguir ejecutable ausente, inicio fallido, timeout, cierre inesperado, JSON-RPC/protocolo inválido, error RPC, cuenta no autenticada, rate limit y dato antiguo. Conservar último snapshot correcto como stale dentro del TTL; no registrar stdout/stderr ni cuerpos completos. |
| Cambios esperables | La superficie está documentada pero experimental; versionar/validar handshake y esquema, tolerar campos opcionales desconocidos, y fallar de forma cerrada ante cambios incompatibles. No cambiar a endpoints privados como fallback. |

Claude Code v1 solo aporta uso local observado, separado de cuota del plan. No se consulta la cuota OAuth no documentada. Gemini y demás productos Google están explícitamente excluidos. No se prometen cuotas de otros proveedores en el primer lanzamiento.

La documentación consultada incluye [Codex App Server](https://learn.chatgpt.com/docs/app-server) (método `account/rateLimits/read`, transporte stdio y advertencia de madurez), la ayuda de [Codex con plan ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan), Anthropic Console en [Usage Reports](https://docs.anthropic.com/en/api/admin-api/usage-cost/get-messages-usage-report), Gemini CLI en su [guía de uso](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/index.md), la restricción OAuth en sus [términos y privacidad](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md) y el aviso de [cambio de productos de consumidor](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals). Revisado el 2026-09-27; revalidar antes de cada integración.

## Contrato de datos normalizado

Cada adaptador debe devolver un resultado por cuenta/producto, sin campos implícitos ni porcentajes inventados:

```text
ProviderSnapshot {
  providerId: string                 // openai, anthropic, google, deepseek
  productId: string                  // codex-chatgpt, claude-code-plan, gemini-api, ...
  accountLabel?: string              // etiqueta local elegida por el usuario; evitar email por defecto
  status: ok | stale | disabled | no_credentials | auth_required |
          unsupported | rate_limited | network_error | invalid_response
  fetchedAt: ISO-8601 UTC
  lastSuccessAt?: ISO-8601 UTC
  validUntil?: ISO-8601 UTC
  metrics: Metric[]
}

Metric {
  id: string
  kind: quota | observed_usage | balance
  scope: account | organization | project | model | session
  window?: { id?: string, durationSeconds?: number,
             startsAt?: ISO-8601 UTC, resetsAt?: ISO-8601 UTC,
             resetTimeZone?: string }
  quantity?: { value: number, unit: requests | tokens | USD | ... }
  limit?: { value: number, unit: ... }
  remaining?: { value: number, unit: ... }
  usedPercent?: number              // solo si limit es conocido y unidad compatible
  source: string                    // endpoint/documented local source, no secreto
}
```

Reglas:

- Mantener separado `quota`, `observed_usage` y `balance`; nunca usar consumo local para inferir cuota restante.
- Conservar unidades y ámbito originales. Para Gemini Developer API, modelar cada dimensión RPM/TPM/RPD de forma independiente.
- `usedPercent` es derivado solo de `used` y `limit` comparables; `remaining = limit - used` solo cuando ambos datos sean válidos y la fuente use esa semántica.
- No inventar una capacidad total cuando el proveedor solo informa uso, ni convertir requests a tokens.
- Guardar etiquetas locales en preferencias; evitar persistir correo, organización o secretos salvo que se diseñe una necesidad concreta.
- Los errores no incluyen token, cabeceras de autorización ni cuerpo HTTP sin filtrar.

## Límite de confianza y credenciales

### Propuesta v1

- Extensión GJS en GNOME Shell. Para cuota Codex, iniciar el proceso oficial `codex app-server` con transporte stdio y hablar JSON-RPC; no inspeccionar su almacenamiento de autenticación ni duplicar su tráfico HTTP. Esta integración queda detrás de un adaptador cancelable para poder contener cambios de protocolo y terminar el subproceso al deshabilitar. Otros conectores podrán usar `Gio.File`/libsoup según su ficha.
- En v1 Codex está habilitado por defecto y puede desactivarse en Preferencias; antes de activarlo, el usuario debe conocer la dependencia de Codex CLI y el carácter experimental del App Server. La autenticación queda a cargo de la sesión de Codex configurada por el usuario.
- No leer ni copiar credenciales Codex desde archivos. El proceso oficial App Server utiliza la cuenta ya configurada por Codex. No registrar líneas JSON-RPC completas, mensajes de error que puedan contener datos sensibles, ni tokens o respuestas de autenticación. Preferencias GSettings guardan habilitación, intervalo, cuenta/ruta y formato; nunca secretos.
- El adaptador Codex no implementa HTTP: inicia `codex app-server` sin shell, con un entorno filtrado mediante lista permitida, y envía JSON-RPC por stdio. El CLI puede usar la sesión local configurada para comunicarse con OpenAI. No habilitar redirecciones ni endpoints propios en la extensión.
- En el menú indicar producto, fuente, estado y última actualización. Documentar antes de instalación que App Server es experimental y que Codex CLI consulta el servicio del proveedor usando la sesión que el usuario ya configuró.
- Si una integración requiere privilegio Admin API (Anthropic Console) o contraviene los términos del producto (OAuth Google Code Assist), no la habilitar.

Este diseño no crea un aislamiento de seguridad fuerte entre la extensión y Shell: GJS sigue ejecutándose dentro del proceso privilegiado de la sesión gráfica. Un helper no elimina el riesgo si simplemente recibe el mismo token. Reconsiderar proceso auxiliar solo si el protocolo requiere permisos propios, almacenamiento Secret Service o aislamiento verificable que la extensión no puede ofrecer.

## Política operativa propuesta

| Parámetro | Valor inicial propuesto |
|---|---|
| Actualización automática | Cada 5 minutos; inmediatamente al habilitar proveedor/activar extensión |
| Actualizar manualmente | Acción en el menú; enfriar a 60 segundos por proveedor |
| Concurrencia | En paralelo entre proveedores; máximo una solicitud activa por adaptador |
| Timeout | 8 segundos por solicitud; cancelar todas al deshabilitar |
| Reintentos | No reintentar auth/4xx salvo que el proveedor indique otra cosa; para red/5xx un reintento con backoff; respetar siempre `Retry-After` |
| Backoff | Exponencial con jitter: 5, 15, 30 y 60 minutos, máximo 60 minutos |
| Caché | En memoria durante la sesión; conservar última respuesta correcta hasta 30 minutos y marcar `stale`; después mostrar no disponible |
| Proveedor con error | Mantener los otros proveedores actualizando; no reemplazar la última respuesta buena con valores vacíos |
| Datos de perfil | No persistir secretos ni respuestas HTTP en disco; persistir solo preferencias y etiquetas configuradas |

Estos valores son punto de partida, no límites del proveedor. Ajustar a cualquier `Retry-After`, documentación de cuotas o política de uso más restrictiva.

## UX propuesta

- Panel: abreviar cada proveedor habilitado con su métrica principal disponible; etiqueta explícitamente porcentaje **libre** o **usado** para evitar ambigüedad. Mostrar `?`/estado discreto cuando no haya cuota, nunca un porcentaje de uso local como sustituto.
- Si los proveedores seleccionados hacen el panel demasiado ancho, opción recomendada: mostrar solo los proveedores favoritos en la barra y el resto en el menú; no rotar valores automáticamente.
- Menú: tarjeta por producto/cuenta, filas por ventana/dimensión, cantidad usada/restante si se conoce, reinicio y hora de actualización; detalle de uso local separado en una sección titulada “Observado en este equipo”.
- Estados visibles y distintos: “desactivado”, “credencial no encontrada”, “requiere iniciar sesión”, “no compatible”, “límite de consulta alcanzado”, “sin conexión”, “respuesta inválida” y “dato antiguo”. No mostrar alertas de error cada ciclo.
- Preferencias: activar/desactivar proveedor, seleccionar perfil, elegir intervalo (5/10/15 min, nunca menos de 1 min), datos visibles y proveedores favoritos del panel. No permitir establecer rutas fuera del home sin aviso explícito.

## Compatibilidad, instalación y validación

- Runtime: GNOME Shell 50 como mínimo; GJS ES modules; GNOME 50 y 51 como primeras versiones de validación. Mantener metadata con versiones estables explícitamente probadas y actualizarlas en releases posteriores.
- Estructura de extensión: `metadata.json`, `extension.js`, `prefs.js`, `schemas/*.gschema.xml`, módulos por proveedor y módulo de normalización/coordinación; ID UUID estable por decidir antes de empaquetar.
- Preferencias: GTK4/Libadwaita vía `ExtensionPreferences` y schema GSettings compilable. No almacenar información de autenticación en settings.
- Transporte: imports GI que se verifiquen en GNOME Shell 50; no asumir disponibilidad de Node `fetch`, `fs`, `process`, `Buffer`, `AbortSignal` u otras APIs de agtop.
- Paquete: `gnome-extensions pack` + schema; instalación local por `gnome-extensions install`, y activación desde Extensions. No copiar el `install.sh` de referencia sin adaptarlo ni requerir reinicio manual del Shell.
- Verificación antes de release: metadata/UUID/schema, pack/install/enable/disable; pruebas unitarias de normalización, carga para todos los estados y red simulada; `gnome-shell-test-tool --extension` cuando disponible; sesión real Wayland en GNOME 50 y la versión estable más reciente declarada.
- Casos mínimos: datos válidos por cada métrica, archivo/token ausente, credencial expirada, 401/403, 429 con y sin `Retry-After`, 5xx, timeout, respuesta rota, proveedor parcial, refresh duplicado, settings cambiados y deshabilitar con solicitud pendiente.

## Decisiones confirmadas (2026-09-27)

1. **Alcance de datos: opción 1A.** La barra prioriza cuota oficial cuando exista un conector admisible. El menú muestra consumo local de sesiones agtop en un bloque separado y optativo; no se infiere cuota restante desde ese consumo.
2. **Fuentes Claude/Codex: opción 2B.** Solo se usan interfaces públicas/documentadas. No portar `chatgpt.com/backend-api/wham/usage` ni `api.anthropic.com/api/oauth/usage` basándose únicamente en agtop. Se usará el RPC documentado del Codex App Server para cuota personal, aceptando el estatus experimental para un lanzamiento personal. Claude puede reportar uso local observado, pero no cuota personal.
3. **Google/Gemini: opción 3A.** Gemini queda fuera de v1. No leer OAuth de Gemini CLI/Code Assist ni consultar su backend. La Gemini Developer API y Antigravity quedan como productos futuros separados que requieren nuevo alcance y una interfaz oficial admisible.

Estas decisiones excluyen fuentes privadas aunque hoy funcionen: el criterio de soporte pesa más que replicar todos los datos visibles en las aplicaciones oficiales. Si un proveedor publica una API autorizada de cuotas, se puede añadir su adaptador sin cambiar el contrato normalizado.

## Gate confirmado del primer lanzamiento

El usuario confirmó que v1 debe seguir el gate A y que **Codex es obligatorio**:

- El primer lanzamiento no se declara completo hasta mostrar cuota oficial de Codex con una fuente pública, documentada y apta para automatización.
- La interfaz identificada es el método JSON-RPC `account/rateLimits/read` del [Codex App Server](https://learn.chatgpt.com/docs/app-server), que entrega límites por ventanas y metadatos de cuenta/créditos. La misma documentación clasifica App Server como experimental y no soportado para cargas de producción.
- El endpoint `chatgpt.com/backend-api/wham/usage` de agtop queda expresamente fuera por la decisión 2B, aunque hoy devuelva los campos requeridos.
- Se puede implementar el shell, preferencias, contrato tipado y conector Codex mediante el adaptador App Server. Se acepta el gate de madurez para un lanzamiento personal/experimental; no etiquetar ni promocionar esta versión como integración estable o soportada para producción.
- Claude plan quota y Gemini quedan fuera del gate v1. Claude solo se incorpora si aparece una interfaz pública admitida; Gemini sigue excluido por la decisión 3A.
- No degradar a scraping, automatización UI ni al endpoint privado de agtop si cambia o deja de estar disponible el App Server.

### Decisión de madurez confirmada

4. **Madurez de v1: opción A.** El primer lanzamiento puede ser personal/experimental, usando Codex App Server stdio. La limitación de soporte debe quedar visible y el adaptador aislado; no describirlo como integración estable para producción.

## Criterios de salida hacia implementación

- Las decisiones de alcance 1A, fuentes 2B y Google 3A están confirmadas.
- El conector Codex usa `account/rateLimits/read` vía App Server stdio, con fixtures de protocolo, manejo de ejecutable ausente/no autenticado, errores JSON-RPC y terminación limpia del subproceso.
- La v1 queda etiquetada como personal/experimental y comunica que App Server no está soportado para producción.
- El contrato de datos y los estados de error de Codex se fijan a partir de esa interfaz.
- UI refleja explícitamente unidad, alcance, semántica de porcentaje y antigüedad.
- Metadata/UUID, shell-version inicial y empaquetado están fijados.
- Las pruebas cubren errores parciales, límites de red, credenciales y ciclo de vida; la prueba manual se realiza en GNOME 50+ Wayland.
