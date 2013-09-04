#!/usr/bin/perl
use strict;
use Digest::MD5 qw(md5_hex);
use Text::Markdown;

our $VERSION = "0.1";

# Don't want to do silly email address escaping.
sub Text::Markdown::_EncodeEmailAddress { return $_[0]; }

my $new_file = "html-markdown-alternative";
my $file = $ARGV[0];

open my $fh, "<", $file;
my $text = join '', <$fh>;
close $fh;

my($headers, $body) = split /\n\n/, $text, 2;

my $html = Text::Markdown::Markdown($body);

$html = <<EOF;
<html>
<head>
<meta name="generator" content="text2mime-markdown/$VERSION">
<style>
code { font-family: 'Andale Mono', 'Lucida Console', 'Bitstream Vera Sans Mono', 'Courier New', monospace; }
pre { border-left: 20px solid #ddd; margin-left: 10px; padding-left: 5px; }
</style>
</head>
<body>
$html
</body>
</html>
EOF

open my $fh, ">", "/tmp/" . $new_file . ".html";
print $fh $html;
close $fh;
