# MVP de agnome-top — task list (Gate 1)

Estado: Gate 1 aprobado; scaffolding y primer corte en implementación. Fuente de alcance: [`definition.md`](definition.md). La raíz tiene Git propio; los repos anidados están excluidos y se preservan.

## Decisiones cerradas

- V1 personal/experimental, Codex con cuota obligatoria.
- Fuente: `codex app-server` por stdio JSONL, protocolo `initialize`/`initialized` y RPC `account/rateLimits/read`.
- Nunca leer `~/.codex/auth.json`, llamar `/wham/usage`, usar scraping o automatización de UI.
- Gemini y cuota Claude fuera del MVP. Cuota oficial y uso local observado permanecen separados; uso local puede quedar para después del primer recorrido Codex.
- GNOME Shell 50+ / GJS. App Server es experimental/no soportado para producción; no presentarlo como estable.

## Cortes verticales

### 0. Scaffolding instalable

- [x] Establecer estructura raíz, UUID provisional `agnome-top@local`, metadata con Shell 50 y 51, schema GSettings y menú de panel mínimo.
- [x] Añadir `.gitignore` para que los repos anidados de referencia no entren en el nuevo repo raíz; inicializar Git raíz sin alterar repos anidados.
- [x] Añadir flujo de paquete local, dependencias de Codex CLI y nota visible de versión personal/experimental.
- [x] **Aceptación parcial:** metadata/schema, empaquetado con módulos importados e instalación del bundle validan. Enable/disable en Shell sigue pendiente.

### 1. Recorrido E2E Codex con App Server simulado — slice de MVP

- [x] Crear adaptador `CodexAppServerClient` con transporte aislado `Gio.Subprocess`/`argv` (sin shell), stdin/stdout stdio JSONL y lector asíncrono de líneas.
- [x] Implementar handshake `initialize` con clientInfo, notificación `initialized`, `account/read` sin refrescar tokens, request correlacionada `account/rateLimits/read`, notificaciones entre respuestas y validación de JSONL.
- [x] Normalizar todos los buckets, ventanas y timestamps a snapshots tipados; preservar porcentaje usado y derivar restante solo para valores válidos.
- [x] Enchufar un fixture ejecutable de App Server simulado al coordinador, indicador breve de panel y menú con una fila por ventana, hora de lectura y estado explícito.
- [x] **Aceptación lógica:** fixture JSONL produce porcentajes, duración y reset en snapshot; datos ausentes no se convierten en cero; UI muestra unidad/semántica y estado experimental. Sin red ni credenciales en pruebas.
- [x] **Pruebas base:** buckets únicos/múltiples, opcionales/null, porcentaje inválido, notificación y correlación, RPC error, JSON roto, proceso simulado y cierre stdin. Timeout, CLI ausente y estados de menú siguen pendientes.

### 2. Ciclo de vida y operación segura

- [x] Serializar sondeos, aplicar timeout de 8 s, refresco inicial + cada 5 min, cooldown manual de 60 s, caché stale de 30 min y backoff con jitter.
- [x] En `disable()`: cancelar I/O, cerrar stdin, terminar proceso si no sale, esperar/recolectar, limpiar timeout y descartar callbacks/resultados tardíos.
- [x] Limitar longitud de línea JSONL, silenciar stderr del hijo y no registrar líneas completas ni mensajes potencialmente sensibles.
- [ ] **Aceptación:** habilitar/deshabilitar y re-habilitar en Shell sin proceso, timer, actor, señal o estado busy huérfano; fallo conserva último snapshot bueno dentro de TTL sin bloquear Shell.
- [ ] **Pruebas:** timeout y salida tardía, disable durante handshake/RPC, disable/re-enable, refresh concurrente, backoff/cache/stale y errores parciales.

### 3. Integración con Codex CLI auténtico

- [x] Resolver `codex` mediante PATH sin shell y ejecutar App Server con autenticación gestionada por la instalación existente.
- [x] Mapear CLI ausente, sesión no autenticada, cuenta incompatible y error RPC a estados comprensibles. No inspeccionar archivos de credenciales.
- [x] **Aceptación de datos:** consulta real verificada con dos ventanas; salida de validación limitada a estado y cantidad de métricas, sin exponer email, token, stdout/stderr o payloads. Documentar que la dependencia sigue experimental.
- **Validación:** sesión GNOME instalada; Codex CLI presente/autenticado y caso sin Codex o autenticación. Verificar enable/disable con `gnome-shell-test-tool` o sesión GNOME disponible.

### 4. Preferencias y primer paquete personal

- [x] Preferencias mínimas: habilitar/deshabilitar Codex y elegir 5/10/15 min; actualizar ahora con cooldown; ver estado de autenticación.
- [x] Empaquetar e instalar localmente; documentar dependencia, alcance personal/experimental y limitaciones.
- [ ] **Aceptación:** probar preferencias GSettings en Shell y retirar limpiamente; verificar que su descripción no afirma soporte de producción.

### 5. Uso local observado (posterior, no bloquea el corte MVP)

- Solo con acuerdo posterior sobre parsers y alcance de sesiones locales; tomar como referencia los agregadores de agtop, sin importar su runtime Node ni mezclar el resultado con cuota.

## Riesgos principales

- App Server y su protocolo pueden cambiar; encapsularlo, validar handshake/esquema y fallar de forma cerrada.
- Shell es un proceso de sesión crítico: toda E/S asíncrona, límite de respuesta, timeout y terminación/recolección explícita del hijo.
- GNOME desalienta scripts/binarios externos en extensiones; usar el CLI instalado por el usuario solo porque es parte esencial del producto Codex y cuidar spawn/salida. El MVP personal no presupone aprobación de Extensions.gnome.org.
- GNOME Shell 51 está disponible en el entorno; no afirmar prueba en Shell 50 si no se ejecuta allí.
- La raíz no tenía Git. Se creó un Git raíz con `.gitignore` que excluye `agtop/`, `gnome-system-monitor-indicator/` y `.harnesstrim/`.

## Gate 2 — futuro

Después de implementar y revisar, presentar resumen del diff, validaciones y mensaje convencional propuesto. No crear commit hasta confirmación explícita.
