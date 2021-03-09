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
  Plug 'thoughtbot/vim-rspec'

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
call plug#end()

if exists('$TMUX')
  let g:tmuxline_preset = 'full'
  autocmd VimEnter * Tmuxline lightline
endif

set background=dark
colorscheme gruvbox
let g:lightline = {}
let g:lightline.colorscheme = 'gruvbox'

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
map <C-P> :Files<CR>
map <C-G> :Rg<CR>

" From http://biodegradablegeek.com/2007/12/using-vim-as-a-complete-ruby-on-rails-ide/
set cf  " Enable error files & error jumping.
set clipboard+=unnamed  " Yanks go on clipboard instead.
set autowrite  " Writes on make/shell commands
set showmatch
set laststatus=2

"Save on losing focus
"au FocusLost * :wa

"My own keybindings
map <leader>gd :Gdiff<CR>
map <leader>gs :Gstatus<CR>
map <leader>gc :Gcommit<CR>
nnoremap <leader><space> :noh<cr>
nnoremap <leader>W :%s/\s\+$//<cr>:let @/=''<CR>
nnoremap <leader>r :.w !bash<cr>
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
map <leader>f yaw:Rg <C-R>"<CR>

map <leader>t :Files<cr>
map <leader>b :Tags<cr>

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
autocmd BufNewFile,BufRead *.proto set ft=cpp
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
map <leader>q gqip<CR>
"set formatprg=par

" map 
nnoremap <F5> :UndotreeToggle<CR>

"" syntastic options for sol
let g:syntastic_cpp_checkers = []
