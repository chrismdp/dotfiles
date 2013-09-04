#!/usr/bin/perl
# https://dgl.cx/2009/03/text2mime-sendmail.pl
# Hacky, hacky, hacky
# But this means we mangle mutt's MIME format less than if we reparsed the lot.
use strict;

use constant SENDMAIL => '/usr/local/bin/msmtp';

my $text = join '', <STDIN>;

my @rnd = ('a' .. 'z', 'A' .. 'Z', 0 .. 9);

# Do we have the magic filename?
if($text =~ s/; filename="html-markdown-alternative\.html"//) {
  # Find the boundary
  $text =~ m!^Content-Type: multipart/mixed; boundary="([^"]+)!m;
  my $boundary = quotemeta $1;

  # See how many parts
  my $count = $text =~ /^--$boundary$/m;

  # Has attachments
  if($count > 2) {
    # Need to add alternative section
    my $alt_boundary = make_boundary();

    s!^(--$boundary\n)!${1}Content-Type: multipart/alternative; boundary="$alt_boundary"\n\n--$alt_boundary\n!m;

    s!^--$boundary\n(Content-Type: text/html)!--$alt_boundary\n$1!m;

    s|^(--$boundary)(?!\nContent-Type: multipart/alternative)|--$alt_boundary--\n$1|m;

  } else {
    $text =~ s!^(Content-Type: multipart/)mixed(; boundary="$boundary)!${1}alternative${2}!m;
  }
}

open my $sendmail, "|-", SENDMAIL, @ARGV;
print $sendmail $text;
close $sendmail;
exit $?;

sub make_boundary {
  my $boundary;
  $boundary .= $rnd[int rand @rnd] for 1 .. 16;
  return $boundary;
}
