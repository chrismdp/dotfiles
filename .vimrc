"filetype off
syntax on

let g:javascript_plugin_flow = 1
let g:polyglot_disabled = ['jsx']

" vim-plug
if empty(glob('~/.vim/autoload/plug.vim'))
  silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs
    \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

call plug#begin()
  Plug 'chemzqm/vim-jsx-improve'
  Plug 'sheerun/vim-polyglot'
  Plug 'tpope/vim-surround'
  Plug 'tpope/vim-abolish'
  Plug 'tpope/vim-fugitive'
  Plug 'tpope/vim-repeat'
  Plug 'tpope/vim-ragtag'
  Plug 'tpope/vim-commentary'

  Plug 'tpope/vim-rails'
  Plug 'tpope/vim-bundler'
  Plug 'tpope/vim-dispatch'
  Plug 'tpope/vim-dadbod'
  Plug 'thoughtbot/vim-rspec'
  Plug 'fatih/vim-go'

  Plug 'knsh14/vim-github-link'

  Plug 'itchyny/lightline.vim'
  Plug 'preservim/nerdtree'
  Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
  Plug 'junegunn/fzf.vim'
  " Plug 'vim-syntastic/syntastic'
  Plug 'mbbill/undotree'
  Plug 'itchyny/lightline.vim'
  Plug 'morhetz/gruvbox'
  Plug 'edkolev/tmuxline.vim'
  Plug 'shinchu/lightline-gruvbox.vim'
  Plug 'Quramy/vison'
  Plug 'dart-lang/dart-vim-plugin'
  Plug 'hankchiutw/flutter-reload.vim'
  " Plug 'dense-analysis/neural'
  " Plug 'dense-analysis/ale'
  Plug 'thosakwe/vim-flutter'
  Plug 'natebosch/vim-lsc'
  Plug 'natebosch/vim-lsc-dart'

  " Svelte
  Plug 'evanleck/vim-svelte'
  Plug 'pangloss/vim-javascript'
  Plug 'HerringtonDarkholme/yats.vim'
  " Plug 'neoclide/coc.nvim', {'branch': 'release'}
  " Plug 'codechips/coc-svelte', {'do': 'npm install'}
  Plug 'prettier/vim-prettier', { 'do': 'npm install' }
  Plug 'Shougo/context_filetype.vim'
call plug#end()

if exists('$TMUX')
  let g:tmuxline_preset = 'full'
  autocmd VimEnter * Tmuxline lightline
endif

set background=dark
colorscheme gruvbox
let g:lightline = {}
let g:lightline.colorscheme = 'gruvbox'

"LSC 
nmap <silent> <C-k> :lbefore<CR>
nmap <silent> <C-j> :lafter<CR>
let g:lsc_auto_map = {'defaults': v:true, 'NextReference': '', 'PreviousReference': ''}
let g:lsc_server_commands = { 'ruby': { 'command': 'ruby-lsp', 'log_level': -1, 'suppress_stderr': v:true } }

filetype plugin indent on
"set modelines=0
set nocompatible

set tabstop=2
set softtabstop=2
set smarttab
set shiftwidth=2
set expandtab
set spelllang=en_gb

set autoindent
set encoding=utf-8
" We have a statusline that does this
set noshowmode
set showcmd

" From http://items.sjbach.com/319/configuring-vim-right
set hidden
let mapleader = ","
let maplocalleader = ","
set history=1000
set wildmenu
set wildmode=list:longest
set ignorecase
set smartcase
set title
set ttyfast
"set cursorline
set scrolloff=3
set backupdir=~/.vim/backups,~/.tmp,~/tmp,/var/tmp,/tmp
set directory=~/.vim/backups,~/.tmp,~/tmp,/var/tmp,/tmp

nnoremap <tab> %
vnoremap <tab> %
nnoremap <C-e> 3<C-e>
nnoremap <C-y> 3<C-y>
set gdefault
set backspace=indent,eol,start

let g:omni_sql_default_compl_type = 'syntax'

"" fix regex handling
"nnoremap / /\v
"vnoremap / /\v

" File-type highlighting and configuration.
" Run :filetype (without args) to see what you may have
" to turn on yourself, or just set them all to be sure.
set incsearch
set shortmess=atI
set visualbell
autocmd FileType make     set noexpandtab
autocmd FileType python   set noexpandtab
set ruler
set number
set hlsearch
syntax on

map <leader>d :execute 'NERDTreeToggle ' . getcwd()<CR>
map <C-P> :GFiles<CR>
map <C-G> :Rg<CR>
command! -bang -nargs=* Rg
  \ call fzf#vim#grep(
  \   'rg --column --line-number --no-heading --color=always --smart-case
  \ -g "*.{js,ts,tsx,json,php,md,styl,jade,html,config,py,cpp,c,go,hs,rb,conf,tf,rake,*haml,*erb,sass,sql,yml,shader,glsl,proto,dart,vim,ts,tsx,svelte}"
  \ -g "!*.{min.js,swp,o,zip,tfstate,gr.dart,freezed.dart,pb.dart,pbtwirp.dart}"
  \ -g "!**app/assets/javascripts/**/*js"
  \ -g "!{.git,node_modules,vendor}/*"
  \ -g "!{sustained/data,sainsburys/products/data,bbcgoodfood/data,spec/fixtures/vcr_cassettes}/*"
  \ -- '.shellescape(<q-args>), 1,
  \   fzf#vim#with_preview(), <bang>0)
let g:fzf_preview_window = ['right:50%', 'ctrl-/']
map <leader>gl :Commits<CR>

" From http://biodegradablegeek.com/2007/12/using-vim-as-a-complete-ruby-on-rails-ide/
set cf  " Enable error files & error jumping.
set clipboard+=unnamed  " Yanks go on clipboard instead.
set autowrite  " Writes on make/shell commands
set showmatch
set laststatus=2

"Save on losing focus
"au FocusLost * :wa

"My own keybindings
map <leader>gd :Git diff<CR>
map <leader>gs :Git status<CR>
map <leader>gc :Git commit<CR>
nnoremap <leader><space> :noh<cr>
nnoremap <leader>W :%s/\s\+$//<cr>:let @/=''<CR>
nnoremap <leader>r :.w !bash<cr>
map <leader>id cc<ESC>!!date +'\%Y-\%m-\%d \%T \%z'<CR>idate: <ESC>
" map <leader>rs :Dispatch rspec %<CR>
" map <leader>ra :Dispatch rspec<CR>
let g:rspec_command = "Dispatch bundle exec rspec {spec}"
map <leader>rf :call RunCurrentSpecFile()<CR>
map <leader>rs :call RunNearestSpec()<CR>
map <leader>ra :call RunAllSpecs()<CR>
"map <leader>pc :ColorHEX<CR>
"map <leader>rs :wa\|!rspec %<CR>
"map <leader>rc :wa\|!cucumber %<CR>
"map <leader>ras :wa\|!rspec spec<CR>
"map <leader>rac :wa\|!cucumber<CR>
"map <leader>zt :wa\|!zeus test %<CR>
"map <leader>zc :wa\|!zeus cucumber %<CR>
"map <leader>zm :wa\|!zeus r script/rails g migration
map <leader>vimrc :tabedit ~/.vimrc<CR>
map <leader>f yiw:Rg <C-R>"<CR>

map <leader>t :Tags<cr>
map <leader>b :Buffers<cr>

" Use .as for ActionScript files, not Atlas files.
au BufNewFile,BufRead *.as set filetype=actionscript
au BufNewFile,BufRead *.ru set filetype=ruby
au BufNewFile,BufRead Gemfile set filetype=ruby
au BufNewFile,BufRead *.md set filetype=mkd

" Understand :W as :w
command! W :w

" Show unwanted whitespace
set listchars=tab:->,trail:·,extends:>
set list!

" Status line
set statusline=%f\ %(%m%r%h\ %)%([%Y]%)%=%<%-20{getcwd()}\ %l/%L\ ~\ %p%%\ \

""Convert hashes to ruby 1.9
"map <leader>H :%s/:\(\w\+\) =>/\1:<CR>``

"json == javascript
"autocmd BufNewFile,BufRead *.json set ft=javascript
"
" Shaders are 'C' for now
autocmd BufNewFile,BufRead *.vertexshader set ft=cpp
autocmd BufNewFile,BufRead *.fragmentshader set ft=cpp
" autocmd BufNewFile,BufRead *.proto set ft=cpp
" rabl files are ruby
autocmd BufNewFile,BufRead *.rabl set ft=ruby
" rcss are css and rml are html
autocmd BufNewFile,BufRead *.rcss set ft=css
autocmd BufNewFile,BufRead *.rml set ft=html
autocmd BufNewFile,BufRead *.sibilant set ft=clojure

" Ignore *.o files in CommandT
set wildignore+=*.o,*.obj,.git,*.mf,*.pb,*.pdf,*.jpg,*.gif,*.png,*/public/js/*

"%% expands to current path
cnoremap %% <C-R>=expand('%:h').'/'<cr>
map <leader>e :edit %%
map <leader>v :view %%
map <leader>wc :!wc %<cr>

set shell=/bin/bash

" use par for formatting
map <leader>q gqq<CR>
"set formatprg=par

" map
nnoremap <F5> :UndotreeToggle<CR>

"" syntastic options for sol
let g:syntastic_cpp_checkers = []

"" Configure Neural
" let g:neural = {
" \   'source': {
" \       'openai': {
" \           'api_key': $OPENAI_API_KEY,
" \       },
" \   },
" \}
" let g:neural.selected = 'chatgpt'

let g:go_dispatch_enabled = 1 " vim-go

" Prettier Settings
let g:prettier#quickfix_enabled = 0
let g:prettier#autoformat = 1
let g:prettier#autoformat_require_pragma = 0
au BufWritePre *.css,*.svelte,*.pcss,*.html,*.ts,*.js,*.json PrettierAsync

if !exists('g:context_filetype#same_filetypes')
  let g:context_filetype#filetypes = {}
endif

let g:context_filetype#filetypes.svelte =
\ [
\   {'filetype' : 'javascript', 'start' : '<script>', 'end' : '</script>'},
\   {
\     'filetype': 'typescript',
\     'start': '<script\%( [^>]*\)\? \%(ts\|lang="\%(ts\|typescript\)"\)\%( [^>]*\)\?>',
\     'end': '',
\   },
\   {'filetype' : 'css', 'start' : '<style \?.*>', 'end' : '</style>'},
\ ]

let g:ft = ''
" NERDCommenter settings

let g:NERDSpaceDelims = 1
let g:NERDCompactSexyComs = 1
let g:NERDCustomDelimiters = { 'html': { 'left': '' } }

" Align comment delimiters to the left instead of following code indentation
let g:NERDDefaultAlign = 'left'

fu! NERDCommenter_before()
  if (&ft == 'html') || (&ft == 'svelte')
    let g:ft = &ft
    let cfts = context_filetype#get_filetypes()
    if len(cfts) > 0
      if cfts[0] == 'svelte'
        let cft = 'html'
      elseif cfts[0] == 'scss'
        let cft = 'css'
      else
        let cft = cfts[0]
      endif
      exe 'setf ' . cft
    endif
  endif
endfu

fu! NERDCommenter_after()
  if (g:ft == 'html') || (g:ft == 'svelte')
    exec 'setf ' . g:ft
    let g:ft = ''
  endif
endfu

" COC
" " nmap ff  (coc-format-selected)
" nmap <leader>rn (coc-rename)
" nmap  gd (coc-definition)
" nmap  gy (coc-type-definition)
" nmap  gi (coc-implementation)
" nmap  gr (coc-references)

" set updatetime=300
" set shortmess+=c " don't give |ins-completion-menu| messages.

" " Make <CR> to accept selected completion item or notify coc.nvim to format
" " <C-g>u breaks current undo, please make your own choice
" inoremap <silent><expr> <CR> coc#pum#visible() ? coc#pum#confirm()
"                               \: "\<C-g>u\<CR>\<c-r>=coc#on_enter()\<CR>"

" set signcolumn=yes

" nmap <silent> <C-k> <Plug>(coc-diagnostic-prev)
" nmap <silent> <C-j> <Plug>(coc-diagnostic-next)

" " GoTo code navigation
" nmap <silent> gd <Plug>(coc-definition)
" nmap <silent> gy <Plug>(coc-type-definition)
" nmap <silent> gi <Plug>(coc-implementation)
" nmap <silent> gr <Plug>(coc-references)

" " Use K to show documentation in preview window
" nnoremap <silent> K :call ShowDocumentation()<CR>

" function! ShowDocumentation()
"   if CocAction('hasProvider', 'hover')
"     call CocActionAsync('doHover')
"   else
"     call feedkeys('K', 'in')
"   endif
" endfunction

" nnoremap <silent> <leader>yd :call StatusDiagnosticToClipboard()<CR>
" function! StatusDiagnosticToClipboard()
"   call setreg('+','')
"   let diagList=CocAction('diagnosticList')
"   let line=line('.') 
"   for diagItem in diagList
"     if line == diagItem['lnum']
"       let str=diagItem['message']
"       call setreg('+',str)
"       return
"     endif
"   endfor 
" endfunction
