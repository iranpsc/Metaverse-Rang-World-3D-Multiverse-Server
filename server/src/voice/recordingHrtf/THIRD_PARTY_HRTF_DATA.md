# HUTUBS HRTF data attribution

This implementation does not bundle the HUTUBS data itself.
The preparation tool downloads `pp1_HRIRs_measured.sofa` from the official SOFA database and converts it to the internal `VMEHRTF1` runtime format.

Dataset: The HUTUBS head-related transfer function (HRTF) database
Authors: Fabian Brinkmann, Manoj Dinakaran, Robert Pelzer, Jan Joschka Wohlgemuth, Fabian Seipel, Daniel Voss, Peter Grosche, Stefan Weinzierl
DOI: 10.14279/depositonce-8487
License: Creative Commons Attribution 4.0 International (CC BY 4.0)
Official data URL: https://sofacoustics.org/data/database/hutubs/
License URL: https://creativecommons.org/licenses/by/4.0/

Runtime does not require SOFA, HDF5, h5py, NumPy, Steam Audio, Resonance Audio, or a Unity audio plugin. Python h5py/NumPy are used only by the one-time conversion tool.
