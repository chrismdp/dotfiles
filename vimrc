"filetype off
execute pathogen#infect()
syntax on

set background=dark
colorscheme base16-default-dark
let g:solarized_termtrans=1
call togglebg#map("<F6>")

filetype plugin indent on
set modelines=0
set nocompatible

set tabstop=2
set softtabstop=2
set smarttab
set shiftwidth=2
set expandtab
set spelllang=en_gb

set autoindent
set encoding=utf-8
set showmode
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

"" fix regex handling
"nnoremap / /\v
"vnoremap / /\v

" File-type highlighting and configuration.
" Run :filetype (without args) to see what you may have
" to turn on yourself, or just set them all to be sure.
set incsearch
set shortmess=atI
set visualbell
" From http://weblog.jamisbuck.org/2008/11/17/vim-follow-up
set grepprg=ack
set grepformat=%f:%l:%m
autocmd FileType make     set noexpandtab
autocmd FileType python   set noexpandtab
set ruler
set number
set hlsearch
syntax on

map <leader>d :execute 'NERDTreeToggle ' . getcwd()<CR>

" From http://biodegradablegeek.com/2007/12/using-vim-as-a-complete-ruby-on-rails-ide/
set cf  " Enable error files & error jumping.
set clipboard+=unnamed  " Yanks go on clipboard instead.
set autowrite  " Writes on make/shell commands
set showmatch
set laststatus=1

"Save on losing focus
"au FocusLost * :wa

"My own keybindings
map <leader>gd :GitDiff<CR>
map <leader>gs :GitStatus<CR>
map <leader>gc :GitCommit<CR>
nnoremap <leader><space> :noh<cr>
nnoremap <leader>W :%s/\s\+$//<cr>:let @/=''<CR>
map <leader>id cc<ESC>!!date +'\%Y-\%m-\%d \%T \%z'<CR>idate: <ESC>
"map <leader>pc :ColorHEX<CR>
"map <leader>rs :wa\|!rspec %<CR>
"map <leader>rc :wa\|!cucumber %<CR>
"map <leader>ras :wa\|!rspec spec<CR>
"map <leader>rac :wa\|!cucumber<CR>
"map <leader>zt :wa\|!zeus test %<CR>
"map <leader>zc :wa\|!zeus cucumber %<CR>
"map <leader>zm :wa\|!zeus r script/rails g migration
map <leader>vimrc :tabedit ~/.vimrc<CR>
map <leader>dts :,$-5d<CR>
map <leader>f yaw:grep <C-R>"

" Run a given vim command on the results of fuzzy selecting from a given shell
" command. See usage below.
function! SelectaCommand(choice_command, selecta_args, vim_command)
  try
    silent let selection = system(a:choice_command . " | selecta " . a:selecta_args)
  catch /Vim:Interrupt/
    " Swallow the ^C so that the redraw below happens; otherwise there will be
    " leftovers from selecta on the screen
    redraw!
    return
  endtry
  redraw!
  exec a:vim_command . " " . selection
endfunction

" Find all files in all non-dot directories starting in the working directory.
" Fuzzy select one of those. Open the selected file with :e.
map <leader>t :call SelectaCommand("find * -type f \| grep -v dist \| grep -v '\.mf$' \| grep -v node_modules \| grep -v '\\.o$'", "", "e")<cr>
" Find all tags in the tags database, then open the tag that the user selects
command! SelectaTag :call SelectaCommand("awk '{print $1}' tags | sort -u | grep -v '^!'", "", "tag")
map <leader>b :SelectaTag<cr>

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
autocmd BufNewFile,BufRead *.json set ft=javascript
"
" Shaders are 'C' for now
autocmd BufNewFile,BufRead *.vertexshader set ft=cpp
autocmd BufNewFile,BufRead *.fragmentshader set ft=cpp
autocmd BufNewFile,BufRead *.proto set ft=cpp
" rabl files are ruby
autocmd BufNewFile,BufRead *.rabl set ft=ruby
" rcss are css and rml are html
autocmd BufNewFile,BufRead *.rcss set ft=css
autocmd BufNewFile,BufRead *.rml set ft=html

" Ignore *.o files in CommandT
set wildignore+=*.o,*.obj,.git,*.mf,*.pb,*.pdf,*.jpg,*.gif,*.png,*/public/js/*

"%% expands to current path
cnoremap %% <C-R>=expand('%:h').'/'<cr>
map <leader>e :edit %%
map <leader>v :view %%
map <leader>wc :!wc %<cr>

set shell=/bin/bash

" use par for formatting
map <leader>q gqip<CR>
"set formatprg=par

" map gundo
nnoremap <F5> :GundoToggle<CR>

"" syntastic options for sol
let g:syntastic_cpp_checkers = []
"let g:syntastic_cpp_check_header = 0
"let g:syntastic_ignore_files = ['\m\cUnity.cpp']
"let g:syntastic_cpp_compiler_options = '-I. -Itest -Isrc -DBOOST_THREAD_USE_LIB -DCURL_STATICLIB -DGLEW_STATIC -DNDEBUG -g -Ilib/include -Idist/build/include/ -Wall -Werror -D_GNU_SOURCE=1 -D_THREAD_SAFE -Idist/build/include/freetype2 -Idist/build/osx/include -Idist/build/osx/include/SDL -mmacosx-version-min=10.6 -Fdist/build/osx/frameworks/ -Idist/build/include/boost -include src/Common.h'
