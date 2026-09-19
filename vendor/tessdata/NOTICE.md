The `.traineddata` files in this directory are Tesseract OCR language data,
redistributed unmodified from the Tesseract project.

- Source: https://github.com/tesseract-ocr/tessdata
- `eng.traineddata` and `heb.traineddata`, gzipped for size.
- Licensed under the Apache License, Version 2.0; the full text is in
  `LICENSE.txt` beside this file, and at http://www.apache.org/licenses/LICENSE-2.0

Copyright the Tesseract OCR contributors.

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

They are gzipped only because Android expands `.gz` assets on install and drops
the extension; `src/lib/ocr.ts` probes at run time for which name is served.
