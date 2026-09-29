## Context

El indicador actual consulta cuota de cuenta mediante `readCodexRateLimits()` y renderiza sus métricas en secciones propias del menú. No existe aún lector de estadísticas locales. La referencia `agtop/index.js` enumera sesiones Codex bajo `~/.codex/sessions/` y suma `event_msg` de tipo `token_count` usando `payload.info.last_token_usage`; esos contadores ya son el origen local, no el límite del plan.

## Goals / Non-Goals

**Goals:** añadir uso de tokens de la sesión reciente y el agregado acotado de las tres sesiones más recientes; mantener las secciones de cuota y uso separadas; evitar repetir trabajo de parseo en cada refresco.

**Non-Goals:** leer las sesiones de Claude, Pi u OpenCode; estimar costos; descubrir procesos para determinar actividad; modificar o borrar archivos de sesión; consultar límites adicionales.

## Decisions

- **Seleccionar por mtime, máximo tres archivos.** Obtener candidatos recursivamente desde `~/.codex/sessions/`, consultar metadatos de archivo y ordenar por modificación descendente. El de mtime más reciente se presenta como sesión reciente; esto es una aproximación barata de actividad, no prueba que el proceso siga activo. Alternativa descartada: inspeccionar procesos abiertos o recorrer todo el historial, por coste y complejidad mayores.
- **Contar eventos `token_count` locales.** Extraer campos numéricos de `last_token_usage` y acumular por archivo, siguiendo la semántica de la referencia agtop. Preservar entrada, entrada cacheada, salida, salida de razonamiento y total cuando existan. No sumar campos superpuestos para fabricar otro total ni inferir una cuota.
- **Lectura asíncrona, acumulación incremental y caché por archivo.** Un lector de sesiones separado del transporte RPC devuelve un snapshot normalizado de uso observado. Mantener tamaño/offset, buffer de línea incompleta y acumuladores por ruta; en refrescos posteriores leer solo bytes añadidos. Si cambia o se trunca un archivo, reconstruir su acumulado. Procesar en fragmentos asíncronos y ceder entre fragmentos para no monopolizar el hilo Shell. Limitar el conjunto a tres rutas y descartar actualizaciones tras cancelar/destruir.
- **Renderizar un snapshot parcial independiente.** Agregar una sección local debajo de la cuota, con fila de sesión reciente y suma de las sesiones seleccionadas, etiqueta “últimas N sesiones” y estado/fecha de actualización. Si el lector falla, conservar la cuota; mostrar no disponible o parcial localmente. Los errores no incluyen contenido de JSONL.

## Risks / Trade-offs

- [mtime no garantiza que la sesión siga activa] → etiquetar “sesión más reciente” y describirlo como selección por actividad de archivo, sin afirmación de proceso activo.
- [Archivos grandes pueden requerir lectura inicial] → limitar a tres archivos, hacer lectura incremental asíncrona y procesar fragmentos con cesión al loop principal.
- [El formato JSONL puede variar o contener líneas parciales] → tolerar campos ausentes y JSON inválido por línea; retener el fragmento final hasta recibir el resto; exponer estado parcial si no puede completarse.
- [Eventos o dimensiones pueden diferir por versión] → aceptar únicamente campos numéricos conocidos, mantener ausencias como desconocidas y nunca derivar una cuota desde el conteo local.

## Migration Plan

No requiere migración ni cambios de preferencias. El nuevo lector se integra al refresco existente y su cancelación sigue el ciclo `disable()` de la extensión.
