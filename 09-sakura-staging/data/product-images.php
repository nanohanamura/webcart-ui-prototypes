<?php
/* Staging prototype: public, read-only additional product images. PHP 5.3. */

@ini_set('display_errors', '0');
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

function nanohana_images_empty_response() {
    return array('schema_version' => 1, 'product' => null, 'products' => array());
}

function nanohana_images_output($payload) {
    echo json_encode($payload);
    exit;
}

function nanohana_images_validate_rows($product_code, $rows) {
    if (count($rows) >= 5) {
        return false;
    }
    $prefix = sprintf('%04d_', $product_code);
    $expected_order = 1;
    $seen = array();
    $images = array();
    foreach ($rows as $row) {
        $asset_id = (string)$row['ASSET_ID'];
        $image_ref = (string)$row['IMAGE_REF'];
        $mode = (string)$row['PROCESSING_MODE'];
        if (!preg_match('/^[0-9a-f]{16}$/', $asset_id) || isset($seen[$asset_id]) ||
                intval($row['SHOHINCD']) !== $product_code ||
                intval($row['HYOJI_JUN']) !== $expected_order ||
                (string)$row['HYOJI_JUN'] !== (string)$expected_order ||
                (string)$row['ASSET_STATE'] !== 'current' ||
                $row['OPERATION_ID'] !== null ||
                ($mode !== 'product' && $mode !== 'information') ||
                ((string)$row['KOKAI_FLG'] !== '0' &&
                 (string)$row['KOKAI_FLG'] !== '1') ||
                $image_ref !== $prefix . $asset_id . '.jpg' ||
                !preg_match('/^[0-9a-f]{64}$/', (string)$row['SHA256']) ||
                !preg_match('/^[0-9a-f]{64}$/', (string)$row['METADATA_VERSION'])) {
            return false;
        }
        $seen[$asset_id] = true;
        $expected_order++;
        if ((string)$row['KOKAI_FLG'] !== '1') {
            continue;
        }
        $path = '/home/nano87/www/webcart/additional-images/' . $image_ref;
        if (!is_file($path) || is_link($path) ||
                @hash_file('sha256', $path) !== (string)$row['SHA256']) {
            return false;
        }
        $images[] = array(
            'display_order' => intval($row['HYOJI_JUN']),
            'mode' => $mode,
            'published' => true,
            'image_url' => 'https://nano87.com/webcart/additional-images/' . $image_ref
        );
    }
    return $images;
}

$empty = nanohana_images_empty_response();
$code_text = isset($_GET['product']) ? trim((string)$_GET['product']) : '';
if (!preg_match('/^[0-9]{1,4}$/', $code_text)) {
    nanohana_images_output($empty);
}
$requested = intval($code_text);
if ($requested < 1 || $requested > 9999) {
    nanohana_images_output($empty);
}

@require_once('/home/nano87/www/webcart/cmn/90030CMN_DBAccess.php');
@require_once('/home/nano87/www/webcart/cmn/90080CMN_Const.php');
if (!function_exists('GetConn')) {
    nanohana_images_output($empty);
}
$objDB = @GetConn();
if (!$objDB) {
    nanohana_images_output($empty);
}
$sql = 'SELECT ASSET_ID, SHOHINCD, HYOJI_JUN, ASSET_STATE, PROCESSING_MODE, ' .
       'KOKAI_FLG, IMAGE_REF, SHA256, METADATA_VERSION, OPERATION_ID ' .
       'FROM MT_GAZO_ADDITIONAL WHERE SHOHINCD = ' . $requested .
       " AND ASSET_STATE <> 'retired' ORDER BY HYOJI_JUN, ASSET_ID LIMIT 5";
$result = @mysql_query($sql, $objDB);
if ($result === false) {
    @mysql_close($objDB);
    nanohana_images_output($empty);
}
$rows = array();
while ($row = @mysql_fetch_assoc($result)) {
    $rows[] = $row;
}
@mysql_free_result($result);
@mysql_close($objDB);
$images = nanohana_images_validate_rows($requested, $rows);
if ($images === false || count($images) === 0) {
    nanohana_images_output($empty);
}
$record = array('SHOHINCD' => $requested, 'images' => $images);
nanohana_images_output(array(
    'schema_version' => 1,
    'product' => $record,
    'products' => array($record)
));
