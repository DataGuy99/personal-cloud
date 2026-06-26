// BLOCK TIER — high-confidence malicious indicators.
// A match here = hard quarantine. These are polyglot/stego attack signatures,
// not things that occur in normal files.

rule suspicious_jpg {
    strings:
        $jpg_header = { FF D8 FF }
        $exe_marker = "MZ" ascii
        $elf_marker = { 7F 45 4C 46 }
    condition:
        $jpg_header at 0 and ($exe_marker in (filesize-1000..filesize) or $elf_marker in (filesize-1000..filesize))
}

rule suspicious_png_zip {
    strings:
        $png_header = { 89 50 4E 47 }
        $zip_marker = { 50 4B 03 04 }
    condition:
        $png_header at 0 and $zip_marker
}

rule oversized_image {
    strings:
        $jpg = { FF D8 FF }
        $png = { 89 50 4E 47 }
    condition:
        ($jpg at 0 or $png at 0) and filesize > 50MB
}
