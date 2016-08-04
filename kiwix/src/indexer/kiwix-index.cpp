/*
 * Copyright 2009-2013 Emmanuel Engelhart <kelson@kiwix.org>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU  General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston,
 * MA 02110-1301, USA.
 */

#include <kiwix/xapianIndexer.h>
#include <getopt.h>

#ifdef _WIN32
#include <Windows.h>
#else
#include <unistd.h>
#endif

void usage() {
    cout << "Usage: kiwix-index [--verbose] ZIM_PATH INDEX_PATH" << endl;
    exit(1);
}

int main(int argc, char **argv) {

  /* Init the variables */
  char *zimFilePath = NULL;
  char *indexPath = NULL;
  bool verboseFlag = false;
  int option_index = 0;
  int c = 0;

  kiwix::XapianIndexer *indexer = NULL;

  /* Argument parsing */
  while (42) {

    static struct option long_options[] = {
      {"verbose", no_argument, 0, 'v'},
      {0, 0, 0, 0}
    };

    if (c != -1) {
      c = getopt_long(argc, argv, "v", long_options, &option_index);

      switch (c) {
	case 'v':
	  verboseFlag = true;
	  break;
      }
    } else {
      if (optind < argc) {
	if (zimFilePath == NULL) {
	  zimFilePath = argv[optind++];
	} else if (indexPath == NULL) {
	  indexPath = argv[optind++];
	} else {
	  usage();
	}
      } else {
	break;
      }
    }
  }

  /* Check if we have enough arguments */
  if (zimFilePath == NULL || indexPath == NULL) {
    usage();
  }

  /* Try to prepare the indexing */
  try {
    indexer = new kiwix::XapianIndexer();
  } catch (...) {
    cerr << "Unable to index '" << zimFilePath << "'." << endl;
    exit(1);
  }

  /* Start the indexing */
  if (indexer != NULL) {
    indexer->setVerboseFlag(verboseFlag);
    indexer->start(zimFilePath, indexPath);
    while (indexer->isRunning()) {
      if (verboseFlag)
	cout << indexer->getProgression() << "% of all the articles indexed..." << endl;
      kiwix::sleep(1000);
    }
    if (verboseFlag)
      cout << "100% of the articles were successfuly indexed..." << endl;
    delete indexer;
  } else {
    cerr << "Unable instanciate the Kiwix indexer." << endl;
    exit(1);
  }

  exit(0);
}
