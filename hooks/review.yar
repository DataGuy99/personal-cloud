// REVIEW TIER — suspicious but legitimately common.
// A match here = flag for human review (pending state), NOT auto-quarantine.
// JS in PDFs is extremely common (forms, Adobe features) but is also a real
// malware vector, so it warrants a look rather than a block or a free pass.

rule pdf_javascript {
    strings:
        $pdf_header = "%PDF"
        $js1 = "/JavaScript" ascii
        $js2 = "/JS" ascii
    condition:
        $pdf_header at 0 and ($js1 or $js2)
}
