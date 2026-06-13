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

rule pdf_javascript {
    strings:
        $pdf_header = "%PDF"
        $js1 = "/JavaScript" ascii
        $js2 = "/JS" ascii
    condition:
        $pdf_header at 0 and ($js1 or $js2)
}

rule oversized_image {
    strings:
        $jpg = { FF D8 FF }
        $png = { 89 50 4E 47 }
    condition:
        ($jpg at 0 or $png at 0) and filesize > 50MB
}
