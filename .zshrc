# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH="/Users/cp/.oh-my-zsh"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
ZSH_THEME="pygmalion"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to automatically update without prompting.
# DISABLE_UPDATE_PROMPT="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# Caution: this setting can cause issues with multiline prompts (zsh 5.7.1 and newer seem to work)
# See https://github.com/ohmyzsh/ohmyzsh/issues/5765
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
autoload -U +X bashcompinit && bashcompinit
plugins=(git vi-mode asdf)

source $ZSH/oh-my-zsh.sh

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"
#
alias be="bundle exec"
alias ts="tmuxstart"
alias gpoh="git push origin HEAD"
alias gg="git log --graph --oneline --decorate --all"
alias gp="git pull"
alias brow='arch --x86_64 /usr/local/Homebrew/bin/brew'
alias brew='/opt/homebrew/bin/brew'
alias gst="git stash"
alias gsp="git stash pop"
alias ghs='GH_PAGER= gh pr view --json statusCheckRollup -q '\''.statusCheckRollup[] | "\(.name + (" " * (30 - (.name | length)))) \(.status | if . == "COMPLETED" then "\u001b[32m" + . + "\u001b[0m" elif . == "IN_PROGRESS" then "\u001b[33m" + . + "\u001b[0m" else . end) \(" " * (15 - (.status | length))) \(.conclusion | if . == "SUCCESS" then "\u001b[32m" + . + "\u001b[0m" elif . == "FAILURE" then "\u001b[31m" + . + "\u001b[0m" elif . == "SKIPPED" then "\u001b[90m" + . + "\u001b[0m" elif . == "IN_PROGRESS" then "\u001b[33m" + . + "\u001b[0m" else . end)"'\'
alias ghv="GH_PAGER= gh pr view && ghs"
alias ghw="gh pr view --web"

bindkey "^R" history-incremental-search-backward
export GPG_TTY=$(tty)
export PATH="/usr/local/opt/ruby/bin:$PATH"
export PATH="/Users/cp/code/flutter/bin:$PATH"
export PATH="/Users/cp/.cargo/bin:$PATH"

# source /opt/homebrew/opt/chruby/share/chruby/chruby.sh
# source /opt/homebrew/opt/chruby/share/chruby/auto.sh

test -e "${HOME}/.iterm2_shell_integration.zsh" && source "${HOME}/.iterm2_shell_integration.zsh" || true

rtr ()
{
  hub issue update "$1" -l "ready for review"
  echo "Marked #"$1" as ready for review."
}
export EDITOR=vim

# source "$(brew --prefix)/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/path.zsh.inc"
# source "$(brew --prefix)/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/completion.zsh.inc"

source ~/.secret_env

# Fixes curl issue: see https://github.com/typhoeus/typhoeus/issues/687
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES


# heroku autocomplete setup
HEROKU_AC_ZSH_SETUP_PATH=/Users/cp/Library/Caches/heroku/autocomplete/zsh_setup && test -f $HEROKU_AC_ZSH_SETUP_PATH && source $HEROKU_AC_ZSH_SETUP_PATH;
# source "${XDG_CONFIG_HOME:-$HOME/.config}/asdf-direnv/zshrc"
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"
export PATH="/Users/cp/bin:$PATH"

# pnpm
export PNPM_HOME="/Users/cp/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
PATH="$HOME/go/bin:$PATH"
export PATH="${ASDF_DATA_DIR:-$HOME/.asdf}/shims:$PATH"

. "$HOME/.local/bin/env"
export PATH="/opt/homebrew/opt/go@1.22/bin:$PATH"
