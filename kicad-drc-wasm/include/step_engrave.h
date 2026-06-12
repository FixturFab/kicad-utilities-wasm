#pragma once

/**
 * Post-process a STEP file exported by KiCad: subtract the silkscreen
 * (exported as planar faces) from the board body as recesses of the given
 * depth, color the recess faces near-white, and rewrite the file in place.
 *
 * @param aPath     path to the STEP file (read and overwritten)
 * @param aDepthMm  engraving depth in millimetres (> 0)
 * @return true if the file was engraved and rewritten
 */
bool EngraveStepInPlace( const char* aPath, double aDepthMm );
