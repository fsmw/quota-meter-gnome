## Purpose

Permite consultar en el dropdown de Quota Meter el uso de tokens registrado en sesiones locales de Codex. Este dato complementa la cuota de la cuenta y mantiene explícita su procedencia y alcance limitado.

## ADDED Requirements

### Requirement: Mostrar uso de tokens local separado de cuota
La extensión SHALL presentar las estadísticas locales de tokens en una sección distinguible de la cuota oficial informada por Codex App Server. SHALL identificar la sesión local más recientemente modificada y el agregado correspondiente a las tres sesiones más recientemente modificadas, indicando que el agregado cubre como máximo esas tres sesiones.

#### Scenario: Hay tres o más sesiones Codex
- **WHEN** existen al menos tres archivos JSONL de sesión legibles
- **THEN** la sección muestra el uso de la sesión más reciente y el agregado de las tres sesiones más recientes, sin etiquetarlo como cuota oficial

#### Scenario: Hay menos de tres sesiones Codex
- **WHEN** existen una o dos sesiones legibles
- **THEN** la sección muestra la sesión más reciente y suma solamente las sesiones disponibles, indicando cuántas se incluyeron

### Requirement: Mostrar dimensiones de tokens disponibles
La extensión SHALL mostrar el total de tokens observado y las dimensiones de entrada, salida, caché y razonamiento cuando los datos de la sesión las provean. SHALL omitir dimensiones desconocidas en vez de inventar valores o equivalencias.

#### Scenario: La sesión registra dimensiones parciales
- **WHEN** los eventos de uso de una sesión contienen solo algunas dimensiones
- **THEN** la interfaz presenta el total y solo las dimensiones conocidas, preservando los valores disponibles

### Requirement: Limitar el alcance a sesiones recientes
La extensión SHALL seleccionar como máximo tres archivos JSONL Codex bajo `~/.codex/sessions/`, ordenados por última modificación descendente. La sesión de uso individual SHALL ser la más recientemente modificada; esta selección es una aproximación de sesión activa basada en actividad reciente.

#### Scenario: Se detectan sesiones recientes
- **WHEN** se enumeran archivos de sesión Codex
- **THEN** solo se leen para calcular uso los tres archivos con mtime más reciente

### Requirement: Leer sesiones sin bloquear el Shell
La extensión SHALL leer y procesar los archivos de sesión de forma asíncrona, limitar cada actualización al conjunto seleccionado, reutilizar resultados cacheados y descartar o cancelar trabajo pendiente cuando se deshabilite. Un archivo ausente, inválido o parcialmente escrito SHALL producir un estado de uso local no disponible o incompleto sin impedir que se muestre la cuota.

#### Scenario: La sesión está siendo escrita
- **WHEN** el lector encuentra una última línea parcial o JSON inválido
- **THEN** ignora esa línea para el cálculo actual y conserva la cuota y las demás estadísticas válidas

#### Scenario: No hay archivos legibles
- **WHEN** no existe una sesión Codex legible
- **THEN** el dropdown comunica que el uso local no está disponible y mantiene visible el estado de cuota

#### Scenario: Se deshabilita la extensión durante la lectura
- **WHEN** el usuario deshabilita la extensión antes de terminar una lectura
- **THEN** el trabajo pendiente se cancela o su resultado se descarta y no actualiza actores destruidos
