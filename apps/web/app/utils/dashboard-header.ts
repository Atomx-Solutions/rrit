const toolbarBase = 'min-h-9 px-3 py-1 gap-2 flex-wrap'

export function dashboardToolbarUi(showBottomDivider = true) {
  return {
    root: showBottomDivider ? toolbarBase : `${toolbarBase} border-b-0`,
    left: 'min-w-0 grow basis-40',
    right: 'shrink-0',
  }
}
