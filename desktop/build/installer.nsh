; Extra Windows uninstall step for SlotForge Circuit.
; The installer associates .slotforge track files with Circuit. electron-builder
; removes the "SlotForge track" file type on uninstall but can leave the
; .slotforge extension key pointing at it. Remove that key too, but only when it
; still belongs to Circuit, so another program's association is never touched.
!macro customUnInstall
  ReadRegStr $0 SHCTX "Software\Classes\.slotforge" ""
  StrCmp $0 "SlotForge track" 0 circuitAssociationDone
    DeleteRegKey SHCTX "Software\Classes\.slotforge"
    DeleteRegKey SHCTX "Software\Classes\SlotForge track"
    ; Tell Explorer that file associations changed.
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  circuitAssociationDone:
!macroend
